import { dockerCopyIn, dockerExec, type ExecResult, type ShopCli, type ShopEnvironment } from '@invertus/e2e-core';

export const PS_ROOT = '/var/www/html';

/** Fixed by the image build; the installer is always run with the default prefix. */
export const DB_PREFIX = 'ps_';

/** Serialises cache clears across Playwright workers; see {@link PrestaShopCli.clearCache}. */
const CACHE_LOCK_FILE = '/tmp/e2e-cache-clear.lock';

/** Minimal escaping for values the kit itself interpolates into diagnostic queries. */
export function escapeSql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Non-zero exits from a shop command are always a hard failure, never a flake. */
export class ShopCliError extends Error {
  constructor(
    message: string,
    readonly argv: string[],
    readonly result: ExecResult,
  ) {
    super(message);
    this.name = 'ShopCliError';
  }
}

/**
 * Executes commands inside the running shop container.
 *
 * Three baked helpers do the heavy lifting so that this class stays free of SQL
 * credentials and PrestaShop internals (they live in the image, next to the code they
 * talk to): `e2e-sql`, `e2e-config`, `e2e-reset-db`.
 */
export class PrestaShopCli implements ShopCli {
  constructor(private readonly env: ShopEnvironment) {
    if (!env.container) {
      throw new Error(
        'No shop container is known. Set E2E_SHOP_CONTAINER or run `e2e-kit up` so the ' +
          'stack state file is written.',
      );
    }
  }

  /** Run an arbitrary argv inside the shop container as the web user. */
  async exec(argv: string[]): Promise<ExecResult> {
    return dockerExec(this.env.container, argv, { user: 'www-data', workdir: PS_ROOT });
  }

  /** Run an argv as root (needed for file placement under /var/www/html). */
  async execAsRoot(argv: string[]): Promise<ExecResult> {
    return dockerExec(this.env.container, argv, { user: 'root', workdir: PS_ROOT });
  }

  private assertOk(argv: string[], result: ExecResult, what: string): ExecResult {
    if (result.code !== 0) {
      throw new ShopCliError(
        `${what} failed (exit ${result.code}): ${argv.join(' ')}\n` +
          `stdout: ${result.stdout.trim()}\nstderr: ${result.stderr.trim()}`,
        argv,
        result,
      );
    }
    return result;
  }

  /**
   * Run `bin/console <command>`. Throws on a non-zero exit.
   *
   * `memory_limit=-1` applies to CLI only: PrestaShop 9's `cache:clear` exhausts the
   * 512 MB web limit, and a cache warmup running out of memory is not a useful signal
   * about the module under test. The web SAPI keeps its realistic limit.
   */
  async console(command: string, args: string[] = []): Promise<ExecResult> {
    const argv = ['php', '-d', 'memory_limit=-1', 'bin/console', command, '--no-interaction', ...args];
    return this.assertOk(argv, await this.exec(argv), 'PrestaShop console command');
  }

  /** Run a SQL statement against the shop database; returns raw tab-separated stdout. */
  async sql(query: string): Promise<string> {
    const argv = ['e2e-sql', '-e', query];
    const result = this.assertOk(argv, await this.exec(argv), 'SQL query');
    return result.stdout;
  }

  /** Run a SQL statement and return the first column of the first row, or null. */
  async sqlScalar(query: string): Promise<string | null> {
    const out = (await this.sql(query)).trim();
    if (!out) return null;
    const firstLine = out.split('\n')[0];
    return firstLine === undefined ? null : (firstLine.split('\t')[0] ?? null);
  }

  /**
   * Write module configuration values directly through `Configuration::updateValue`.
   * Fast and UI-independent — the way PSP `setup()` implementations are expected to
   * configure a module (spec §6.2).
   */
  async setModuleConfig(moduleName: string, values: Record<string, string>): Promise<void> {
    const entries = Object.entries(values);
    if (entries.length === 0) return;
    const argv = ['e2e-config', 'set-many', moduleName, JSON.stringify(values)];
    this.assertOk(argv, await this.exec(argv), `Configuring module '${moduleName}'`);
  }

  async getConfig(name: string): Promise<string | null> {
    const argv = ['e2e-config', 'get', name];
    const result = await this.exec(argv);
    if (result.code !== 0) return null;
    const value = result.stdout.replace(/\n$/, '');
    return value === '' ? null : value;
  }

  async setConfig(name: string, value: string): Promise<void> {
    const argv = ['e2e-config', 'set', name, value];
    this.assertOk(argv, await this.exec(argv), `Setting configuration '${name}'`);
  }

  /** Copy a host path into the container (used to place a built module). */
  async copyIn(hostPath: string, containerPath: string): Promise<void> {
    await dockerCopyIn(this.env.container, hostPath, containerPath);
    // docker cp preserves host ownership, which the web user cannot read.
    await this.execAsRoot(['chown', '-R', 'www-data:www-data', containerPath]);
  }

  /** Fast database reset back to the baked seed state (spec §4.1 item 6). */
  async resetDatabase(): Promise<void> {
    const argv = ['e2e-reset-db'];
    this.assertOk(argv, await this.execAsRoot(argv), 'Database reset');
  }

  /** True when the named module directory exists in the shop. */
  async moduleExists(name: string): Promise<boolean> {
    const result = await this.exec(['test', '-d', `${PS_ROOT}/modules/${name}`]);
    return result.code === 0;
  }

  /** True when the named module is installed AND active. */
  async moduleIsActive(name: string): Promise<boolean> {
    const value = await this.sqlScalar(
      `SELECT active FROM \`${DB_PREFIX}module\` WHERE name = '${escapeSql(name)}'`,
    );
    return value === '1';
  }

  /**
   * Clear the PrestaShop cache; required after most configuration changes.
   *
   * Two things here are load-bearing:
   *
   * - `--env=prod`, because otherwise Symfony clears the dev cache, which the shop does
   *   not serve from, and the change under test silently does not take effect.
   * - `flock`, because two Playwright workers clearing the cache at the same time make
   *   each other fail ("Failed opening required .../getRouting_LoaderService.php") — one
   *   deletes the cache directory the other is mid-way through rebuilding. Serialising
   *   clears inside the container costs nothing and removes a whole class of flake.
   */
  async clearCache(): Promise<void> {
    const argv = [
      'flock',
      CACHE_LOCK_FILE,
      'php',
      '-d',
      'memory_limit=-1',
      'bin/console',
      'cache:clear',
      '--no-interaction',
      '--env=prod',
    ];
    this.assertOk(argv, await this.exec(argv), 'Cache clear');
  }
}
