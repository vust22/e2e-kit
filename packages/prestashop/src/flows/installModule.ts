import path from 'node:path';
import { existsSync } from 'node:fs';
import { PS_ROOT, type PrestaShopCli } from '../cli/ShopCli.js';

export interface InstallModuleOptions {
  /** Module technical name; also the directory name under `modules/`. */
  name: string;
  /** Directory on the host containing the built module source. */
  sourceDir?: string;
  /** Zip archive on the host, as produced by a module's release build. */
  zipPath?: string;
}

export class ModuleInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleInstallError';
  }
}

/**
 * Place a module into the running shop and install it (spec §3.5).
 *
 * Installation goes through `bin/console prestashop:module install`, not the back office:
 * the CLI is faster, has no selectors to drift, and returns a real exit code — so a
 * broken module fails as a build error rather than as a mysterious timeout later.
 */
export async function installModule(cli: PrestaShopCli, opts: InstallModuleOptions): Promise<void> {
  const target = `${PS_ROOT}/modules/${opts.name}`;

  if (opts.zipPath) {
    if (!existsSync(opts.zipPath)) {
      throw new ModuleInstallError(`zipPath does not exist on the host: ${opts.zipPath}`);
    }
    const remoteZip = `/tmp/${path.basename(opts.zipPath)}`;
    await cli.copyIn(opts.zipPath, remoteZip);
    const unzip = await cli.execAsRoot(['unzip', '-o', '-q', remoteZip, '-d', `${PS_ROOT}/modules/`]);
    if (unzip.code !== 0) {
      throw new ModuleInstallError(`Failed to unpack ${opts.zipPath}: ${unzip.stderr || unzip.stdout}`);
    }
  } else if (opts.sourceDir) {
    if (!existsSync(opts.sourceDir)) {
      throw new ModuleInstallError(`sourceDir does not exist on the host: ${opts.sourceDir}`);
    }
    // `docker cp <dir>/. <target>` copies the contents, not the directory itself.
    await cli.execAsRoot(['mkdir', '-p', target]);
    await cli.copyIn(`${opts.sourceDir}/.`, target);
  } else {
    throw new ModuleInstallError('installModule needs either sourceDir or zipPath');
  }

  if (!(await cli.moduleExists(opts.name))) {
    throw new ModuleInstallError(
      `After copying, ${target} does not exist in the container. ` +
        'Check that the module source directory is named after the module.',
    );
  }

  await cli.execAsRoot(['chown', '-R', 'www-data:www-data', target]);

  // Two Playwright workers installing the same module at once corrupts the module tables, and
  // `moduleInstalled` is a per-worker fixture — so the install itself is serialised in the
  // container, the same way cache clears are.
  const result = await cli.exec([
    'flock',
    '/tmp/e2e-module-install.lock',
    'php',
    'bin/console',
    'prestashop:module',
    'install',
    opts.name,
    '--no-interaction',
  ]);

  // The console command reports some failures with exit 0 and an error line, so the
  // module's own active flag is the assertion that actually means something.
  const installed = await cli.moduleIsActive(opts.name);
  if (result.code !== 0 || !installed) {
    throw new ModuleInstallError(
      `Installing module '${opts.name}' failed (exit ${result.code}, active=${installed}).\n` +
        `stdout: ${result.stdout.trim()}\nstderr: ${result.stderr.trim()}`,
    );
  }

  // A payment module installed after a carrier exists is not associated with it, and
  // PrestaShop then silently offers no payment method at all. Harmless for non-payment
  // modules, so it runs unconditionally rather than guessing what kind of module this is.
  await cli.exec(['e2e-config', 'carriers-allow', opts.name]);

  await cli.clearCache();
}

/** Remove a module again; used by suites that need a clean slate between runs. */
export async function uninstallModule(cli: PrestaShopCli, name: string): Promise<void> {
  await cli.exec(['php', 'bin/console', 'prestashop:module', 'uninstall', name, '--no-interaction']);
  await cli.clearCache();
}
