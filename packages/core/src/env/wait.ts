import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Environment boot failures must be distinguishable from test failures so that the
 * healing harness never fires on them (spec §8.2, §9.1).
 */
export class EnvBootError extends Error {
  readonly annotation = 'ENV_BOOT_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'EnvBootError';
  }
}

export interface WaitForHttpOptions {
  url: string;
  /** Boot budget in ms. Spec §8.2 sets the CI target at 90s. */
  timeoutMs?: number;
  intervalMs?: number;
  expectStatus?: number[];
  /** Called with a short status line roughly once per second. */
  onProgress?: (message: string) => void;
}

/** Poll a URL until it answers with an accepted status, or fail with {@link EnvBootError}. */
export async function waitForHttpOk(opts: WaitForHttpOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const expectStatus = opts.expectStatus ?? [200];
  const deadline = Date.now() + timeoutMs;

  let lastDetail = 'no response yet';
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), Math.min(intervalMs * 5, 10_000));
      // Redirects are followed: a seeded shop with more than one language answers
      // /index.php with a 302 to its language-prefixed URL, which is a ready shop, not a
      // failure.
      const res = await fetch(opts.url, { redirect: 'follow', signal: controller.signal });
      clearTimeout(abortTimer);
      if (expectStatus.includes(res.status)) return;
      lastDetail = `HTTP ${res.status}`;
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
    }
    const elapsed = Math.round((timeoutMs - (deadline - Date.now())) / 1000);
    opts.onProgress?.(`waiting for ${opts.url} (${elapsed}s, ${lastDetail})`);
    await sleep(intervalMs);
  }

  throw new EnvBootError(
    `ENV_BOOT_FAILED: ${opts.url} did not become ready within ${Math.round(timeoutMs / 1000)}s ` +
      `after ${attempts} attempts. Last: ${lastDetail}`,
  );
}

/** Poll a predicate until it returns true. Used for eventual consistency in helpers. */
export async function waitFor(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${opts.description ?? 'condition'}`,
  );
}
