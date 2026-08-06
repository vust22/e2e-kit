import { createHmac } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

/** HMAC signer for providers that sign webhook payloads. Returns a lowercase hex digest. */
export function signWebhook(
  payload: string,
  secret: string,
  algo: 'sha256' | 'sha512' = 'sha256',
): string {
  return createHmac(algo, secret).update(payload, 'utf8').digest('hex');
}

export interface PostWebhookOptions {
  /** Absolute URL, e.g. `${shopUrl}/index.php?fc=module&module=mollie&controller=webhook`. */
  url: string;
  body: string | Record<string, unknown>;
  headers?: Record<string, string>;
  /** Accepted response statuses. Default `[200, 201, 204]`. */
  expectStatus?: number[];
  /** Retry count on network error or unexpected status. Default 3, exponential backoff. */
  retries?: number;
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly attempts: number,
    readonly lastStatus?: number,
    readonly lastBody?: string,
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

/** POST a webhook body to the shop with retries and a 2xx assertion. */
export async function postWebhook(opts: PostWebhookOptions): Promise<Response> {
  const expectStatus = opts.expectStatus ?? [200, 201, 204];
  const retries = opts.retries ?? 3;

  const isForm = typeof opts.body === 'string';
  const headers: Record<string, string> = {
    'content-type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
    ...opts.headers,
  };
  const body = isForm ? (opts.body as string) : JSON.stringify(opts.body);

  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(opts.url, { method: 'POST', headers, body });
      if (expectStatus.includes(res.status)) return res;
      lastStatus = res.status;
      lastBody = (await res.text()).slice(0, 2000);
    } catch (err) {
      lastError = err;
    }
    if (attempt <= retries) await sleep(250 * 2 ** (attempt - 1));
  }

  throw new WebhookDeliveryError(
    `Webhook delivery to ${opts.url} failed after ${retries + 1} attempt(s)` +
      (lastStatus !== undefined
        ? `: last status ${lastStatus}, body: ${lastBody}`
        : `: ${String(lastError)}`),
    opts.url,
    retries + 1,
    lastStatus,
    lastBody,
  );
}
