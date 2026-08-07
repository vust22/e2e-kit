import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Run a piece of setup exactly once per run, across Playwright worker processes.
 *
 * Spec §3.6 says `PspContract.setup` is "called once before the suite", and module installation is
 * the same kind of thing: both mutate the one shared shop. Playwright's worker fixtures are
 * per-worker, so a naive implementation runs them N times in parallel against a single shop —
 * concurrent `cache:clear`, concurrent module installs, concurrent config writes. The symptoms are
 * varied and none of them point at the cause.
 *
 * Workers are separate processes, so the coordination has to be on disk. `mkdir` is atomic on
 * every platform we support, which makes it a lock without a dependency: whoever creates the
 * directory owns the work, everyone else waits for the result marker.
 */

export interface RunOnceOptions {
  /** Directory to coordinate through — the consumer's `.e2e-kit/` (per stack, per run). */
  stateDir: string;
  /** Distinguishes independent one-time steps, e.g. `'module-install'`. */
  key: string;
  /** How long a waiter will wait for the owner to finish. */
  timeoutMs?: number;
}

export class RunOnceError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'RunOnceError';
  }
}

/**
 * Returns the work's result — computed here if this process won the lock, or read back from the
 * marker if another process did it.
 *
 * A failure is recorded too, so the other workers fail immediately with the original error instead
 * of each spending the full timeout discovering the same thing.
 */
export async function runOnce<T>(
  opts: RunOnceOptions,
  work: () => Promise<T>,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const lockDir = path.join(opts.stateDir, `.once-${opts.key}.lock`);
  const marker = path.join(opts.stateDir, `.once-${opts.key}.json`);

  mkdirSync(opts.stateDir, { recursive: true });

  if (existsSync(marker)) return readMarker<T>(marker, opts.key);

  let owner = false;
  try {
    mkdirSync(lockDir);
    owner = true;
  } catch {
    owner = false;
  }

  if (owner) {
    try {
      const value = await work();
      writeMarker(marker, { ok: true, value });
      return value;
    } catch (error) {
      writeMarker(marker, {
        ok: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      throw error;
    } finally {
      rmSync(lockDir, { recursive: true, force: true });
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(marker)) return readMarker<T>(marker, opts.key);
    await sleep(250);
  }

  throw new RunOnceError(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for another worker to finish ` +
      `one-time setup '${opts.key}'. If a previous run was killed mid-setup, remove ${lockDir}.`,
  );
}

function writeMarker(marker: string, payload: unknown): void {
  // Written via a temp file and renamed, so a waiter can never read a half-written marker.
  const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), 'e2e-once-')), 'marker.json');
  writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  writeFileSync(marker, readFileSync(tmp, 'utf8'), 'utf8');
  rmSync(path.dirname(tmp), { recursive: true, force: true });
}

function readMarker<T>(marker: string, key: string): T {
  const parsed = JSON.parse(readFileSync(marker, 'utf8')) as
    | { ok: true; value: T }
    | { ok: false; error: string };
  if (!parsed.ok) {
    throw new RunOnceError(
      `One-time setup '${key}' already failed in another worker: ${parsed.error}`,
    );
  }
  return parsed.value;
}
