import { run, runOrThrow, type RunOptions } from './process.js';
import type { ExecResult } from '../platform/types.js';

export interface ComposeStackOptions {
  /** Docker Compose project name; isolates parallel stacks on one machine. */
  projectName: string;
  /** Absolute paths to compose files, in overlay order (base first). */
  files: string[];
  /** Directory compose resolves relative paths against. */
  cwd: string;
  /** Variables interpolated into the compose files. */
  env: Record<string, string>;
}

/**
 * Thin wrapper over `docker compose`. Deliberately not an abstraction layer — the kit
 * uses plain compose so that anything a developer runs by hand behaves identically
 * (Design principle 1, Goal 7).
 */
export class ComposeStack {
  constructor(private readonly opts: ComposeStackOptions) {}

  private baseArgv(): string[] {
    const argv = ['docker', 'compose', '-p', this.opts.projectName];
    for (const file of this.opts.files) argv.push('-f', file);
    return argv;
  }

  private runOpts(inherit = false): RunOptions {
    return {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      inherit,
    };
  }

  async up(opts: { inherit?: boolean } = {}): Promise<void> {
    await runOrThrow(
      [...this.baseArgv(), 'up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '300'],
      this.runOpts(opts.inherit ?? true),
    );
  }

  async down(opts: { volumes?: boolean; inherit?: boolean } = {}): Promise<void> {
    const argv = [...this.baseArgv(), 'down', '--remove-orphans'];
    if (opts.volumes !== false) argv.push('-v');
    await run(argv, this.runOpts(opts.inherit ?? true));
  }

  /** Resolve the container id of a compose service, or null when it is not running. */
  async containerId(service: string): Promise<string | null> {
    const res = await run([...this.baseArgv(), 'ps', '-q', service], this.runOpts(false));
    const id = res.stdout.trim().split('\n')[0]?.trim();
    return id ? id : null;
  }

  async containerIdOrThrow(service: string): Promise<string> {
    const id = await this.containerId(service);
    if (!id) {
      throw new Error(
        `Compose service '${service}' is not running in project '${this.opts.projectName}'. ` +
          `Run \`e2e-kit up\` first.`,
      );
    }
    return id;
  }

  /** Published host port for a service's container port, e.g. `port('shop', 80)`. */
  async port(service: string, containerPort: number): Promise<string | null> {
    const res = await run(
      [...this.baseArgv(), 'port', service, String(containerPort)],
      this.runOpts(false),
    );
    const line = res.stdout.trim();
    return line ? line : null;
  }

  async logs(service: string, tail = 200): Promise<string> {
    const res = await run(
      [...this.baseArgv(), 'logs', '--no-color', '--tail', String(tail), service],
      this.runOpts(false),
    );
    return res.stdout + res.stderr;
  }

  async exec(service: string, argv: string[]): Promise<ExecResult> {
    return run([...this.baseArgv(), 'exec', '-T', service, ...argv], this.runOpts(false));
  }
}

/** `docker exec` against a container id, bypassing compose (used by ShopCli in tests). */
export async function dockerExec(
  container: string,
  argv: string[],
  opts: { user?: string; workdir?: string } = {},
): Promise<ExecResult> {
  const prefix = ['docker', 'exec'];
  if (opts.user) prefix.push('-u', opts.user);
  if (opts.workdir) prefix.push('-w', opts.workdir);
  return run([...prefix, container, ...argv]);
}

/** `docker cp` a host path into a container. */
export async function dockerCopyIn(
  container: string,
  hostPath: string,
  containerPath: string,
): Promise<void> {
  await runOrThrow(['docker', 'cp', hostPath, `${container}:${containerPath}`]);
}
