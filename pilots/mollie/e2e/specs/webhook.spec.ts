import { test, expect } from '@invertus/e2e-prestashop';

/**
 * v1 custom spec #3 (spec §6.3): "webhook endpoint returns 200 for unknown payment id without
 * creating orders".
 *
 * The webhook is the one endpoint the outside world can reach unauthenticated, so its behaviour on
 * garbage input is a security property, not a nicety. What the module actually does — verified in
 * `NOTES.md` §1 — is stricter than the spec's phrasing assumed, and these tests assert the real
 * contract rather than the assumed one.
 */
test.describe('mollie: webhook endpoint', () => {
  const webhookUrl = (shopUrl: string) =>
    `${shopUrl}/index.php?fc=module&module=mollie&controller=webhook`;

  test('a request with no security token is rejected', async ({ page, shopUrl }) => {
    const response = await page.request.post(webhookUrl(shopUrl), {
      form: { id: 'tr_doesnotexist' },
    });

    // `webhook.php:71` answers 400 "Missing security token" before looking at anything else.
    expect(
      response.status(),
      'the webhook accepted a request with no security token',
    ).toBe(400);
  });

  test('an unknown payment id does not create an order', async ({ page, shopUrl, shopCli }) => {
    const before = await orderCount(shopCli);

    const response = await page.request.post(webhookUrl(shopUrl), {
      form: { id: 'tr_e2edoesnotexistatall', security_token: 'e2e-not-a-real-token' },
    });

    // The module fetches the payment from the API, the mock answers 404, and the controller turns
    // that into a client error. The value that matters is that it is handled, not that it is 200:
    // any 5xx would mean an unhandled exception on an unauthenticated endpoint.
    expect(
      response.status(),
      `the webhook returned ${response.status()} for an unknown payment id — a 5xx here means an ` +
        'unhandled exception on a publicly reachable endpoint',
    ).toBeLessThan(500);

    expect(
      await orderCount(shopCli),
      'the webhook created an order for a payment id that does not exist',
    ).toBe(before);
  });

  test('a malformed body does not create an order', async ({ page, shopUrl, shopCli }) => {
    const before = await orderCount(shopCli);

    const response = await page.request.post(webhookUrl(shopUrl), {
      form: { security_token: 'e2e-not-a-real-token' },
    });

    // No `id` at all: `webhook.php:82` answers 422.
    expect(response.status()).toBe(422);
    expect(await orderCount(shopCli), 'a body with no payment id created an order').toBe(before);
  });
});

async function orderCount(shopCli: { sql(query: string): Promise<string> }): Promise<number> {
  const out = await shopCli.sql('SELECT COUNT(*) AS c FROM ps_orders;');
  const match = out.match(/(\d+)/);
  if (!match) throw new Error(`Could not read an order count from: '${out}'`);
  return Number(match[1]);
}
