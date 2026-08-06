import { spawn, type SpawnOptions } from 'node:child_process';
import type { ExecResult } from '../platform/types.js';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Stream child output to this process's stdio as it happens. */
  inherit?: boolean;
  input?: string;
  timeoutMs?: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly argv: string[],
    readonly result: ExecResult,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Run a command, capturing stdout/stderr. Never throws on a non-zero exit code. */
export function run(argv: string[], opts: RunOptions = {}): Promise<ExecResult> {
  const [cmd, ...args] = argv;
  if (!cmd) return Promise.reject(new Error('run() called with an empty argv'));

  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: opts.inherit ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  };

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, spawnOpts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        stderr += `\n[e2e-kit] command timed out after ${opts.timeoutMs}ms`;
      }, opts.timeoutMs);
    }

    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
    }
    child.stdin?.end();

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Run a command and throw {@link CommandError} unless it exits 0. */
export async function runOrThrow(argv: string[], opts: RunOptions = {}): Promise<ExecResult> {
  const result = await run(argv, opts);
  if (result.code !== 0) {
    throw new CommandError(
      `Command failed (exit ${result.code}): ${argv.join(' ')}\n${result.stderr || result.stdout}`.trim(),
      argv,
      result,
    );
  }
  return result;
}
