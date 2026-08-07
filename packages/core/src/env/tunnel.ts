import { setTimeout as sleep } from 'node:timers/promises';
import { run } from './process.js';
import type { ComposeStack } from './compose.js';

/**
 * Cloudflare quick-tunnel support for sandbox mode (spec §6.5).
 *
 * A quick tunnel prints the hostname it was assigned to its own log and nowhere else — there is no
 * API to ask, and no way to request a specific name. So the only way to learn it is to read the
 * log, which is what this does.
 */

/** `https://<random-words>.trycloudflare.com` as it appears in cloudflared's log output. */
const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export class TunnelError extends Error {
  constructor(message: string, readonly log?: string) {
    super(message);
    this.name = 'TunnelError';
  }
}

export interface WaitForTunnelOptions {
  stack: ComposeStack;
  service?: string;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
}

/**
 * Wait until the tunnel reports its public URL, and return it.
 *
 * Quick-tunnel hostnames are rate-limited and occasionally slow to appear, which is one of the
 * reasons sandbox jobs are non-blocking on PRs (spec §8.4). The failure is reported with the tail
 * of the log, because "no hostname yet" and "rate limited, try later" look identical from the
 * outside and only the log distinguishes them.
 */
export async function waitForQuickTunnel(opts: WaitForTunnelOptions): Promise<string> {
  const service = opts.service ?? 'cloudflared';
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastLog = '';

  while (Date.now() < deadline) {
    lastLog = await opts.stack.logs(service, 400);
    const match = lastLog.match(QUICK_TUNNEL_URL);
    if (match) return match[0];

    const elapsed = Math.round((timeoutMs - (deadline - Date.now())) / 1000);
    opts.onProgress?.(`waiting for the quick-tunnel hostname (${elapsed}s)`);
    await sleep(2_000);
  }

  throw new TunnelError(
    `The Cloudflare quick tunnel never published a hostname within ${Math.round(timeoutMs / 1000)}s. ` +
      'Quick tunnels are rate-limited; the documented fallback is a named tunnel on the ' +
      'invertus.pro zone with a per-run subdomain (spec §6.5 item 3).\n' +
      `cloudflared log tail:\n${tail(lastLog)}`,
    lastLog,
  );
}

/** Confirm the tunnel actually reaches the shop before handing the URL to a provider. */
export async function assertTunnelReachesShop(publicUrl: string): Promise<void> {
  const probe = await run(['curl', '-fsS', '-o', '/dev/null', '-w', '%{http_code}', `${publicUrl}/index.php`]);
  if (probe.code !== 0 || !probe.stdout.startsWith('2')) {
    throw new TunnelError(
      `The quick tunnel published ${publicUrl}, but the shop is not reachable through it ` +
        `(curl exit ${probe.code}, status ${probe.stdout.trim() || 'none'}). Mollie would fail to ` +
        'deliver webhooks, so the run would be misleading rather than merely slow.',
    );
  }
}

function tail(log: string, lines = 20): string {
  return log.split('\n').slice(-lines).join('\n');
}
