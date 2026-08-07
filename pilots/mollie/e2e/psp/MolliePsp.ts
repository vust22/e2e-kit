import {
  postWebhook,
  type ApiCallsQuery,
  type BackOfficeRefundOptions,
  type CompleteHostedCheckoutOptions,
  type EnsureWebhookProcessedOptions,
  type HostedCheckoutOutcome,
  type HostedCheckoutResult,
  type ProviderApiCall,
  type PspContext,
  type PspContract,
  type PspSetupTools,
} from '@invertus/e2e-core';
import type { AdminPanel } from '@invertus/e2e-prestashop';
import { expect } from '@invertus/e2e-prestashop';

/**
 * The Mollie implementation of the kit's PSP contract (spec §6.2).
 *
 * This is the *only* provider-specific code in the pilot, and it lives in the consumer repo by
 * design (§3.6): onboarding Adyen or Stripe means writing one class like this, with nothing in
 * `e2e-kit` changing.
 *
 * Every constant and control-flow decision below was verified against the module source at
 * release 6.4.4 — see `e2e/NOTES.md`, which cites the file and line for each. Where the spec's
 * §6.2 sketch differs, `NOTES.md` says why the sketch was wrong.
 */

/** `HostedCheckoutOutcome` → the status the Mollie API reports. */
const OUTCOME_TO_MOLLIE_STATUS: Record<HostedCheckoutOutcome, string> = {
  paid: 'paid',
  failed: 'failed',
  canceled: 'canceled',
  expired: 'expired',
  pending: 'open',
  authorized: 'authorized',
};

/**
 * `ApiKeyService::validateApiKey` enforces `/^test_\w{30,}$/`. The spec's sketch value has only
 * 28 characters after the prefix, which makes `getApiClient()` return null and every checkout
 * silently offer no Mollie methods.
 */
const MOCK_API_KEY = 'test_e2emockmockmockmockmockmockmockmock';

/** Where the mock's browser-facing side and control plane are published by the mock overlay. */
const MOCK_URL = process.env.MOLLIE_MOCK_URL ?? 'http://localhost:8090';

/**
 * Methods seeded into `mol_payment_method`, and which Mollie API each uses.
 *
 * Both APIs are live code paths in the module, chosen per method from this column
 * (`PaymentMethodService:483`), so the matrix deliberately covers both — a payments-API-only
 * setup would leave half the module untested.
 */
const SEEDED_METHODS: { id: string; name: string; api: 'payments' | 'orders' }[] = [
  { id: 'ideal', name: 'iDEAL', api: 'payments' },
  { id: 'creditcard', name: 'Card', api: 'payments' },
  { id: 'banktransfer', name: 'Bank transfer', api: 'orders' },
];

interface MockResource {
  id: string;
  resource: 'payment' | 'order';
  paymentId: string;
  status: string;
  orderReference: string | null;
  cartId: number | string | null;
  webhookUrl: string | null;
  redirectUrl: string | null;
  checkoutUrl: string | null;
  amount: { currency: string; value: string };
}

export class MolliePsp implements PspContract {
  readonly id = 'mollie';
  readonly methods = SEEDED_METHODS.map((m) => m.id);

  /**
   * Configure the module for the current mode.
   *
   * Two `Configuration` values and a set of `mol_payment_method` rows are all it takes. Both
   * are written through `ShopCli` rather than the back office: setup runs once per worker and
   * must not be able to fail on a selector (spec §6.2).
   */
  async setup(ctx: PspContext, { shopCli }: PspSetupTools): Promise<void> {
    const apiKey =
      ctx.mode === 'sandbox' ? requireSecret(ctx, 'MOLLIE_TEST_API_KEY') : MOCK_API_KEY;

    await shopCli.setModuleConfig('mollie', {
      MOLLIE_API_KEY_TEST: apiKey,
      MOLLIE_ENVIRONMENT: '0', // Config::ENVIRONMENT_TEST
      // No API endpoint setting exists, and none is needed: in mock mode the compose network
      // resolves api.mollie.com to the mock (§6.4). Module code and config are identical in
      // both modes apart from the key.

      // Mollie Components off (Config::MOLLIE_IFRAME, 'sandbox' slot in test mode).
      //
      // With it on, the card option renders Mollie's hosted card fields as iframes from
      // js.mollie.com and the module intercepts the place-order submit to tokenise them
      // (views/js/front/mollie_iframe.js:128). That makes the card method untestable in mock mode
      // for two independent reasons: the fields come from the real internet, so the run stops
      // being hermetic, and no token means the submit never completes. Off, the card method uses
      // the module's own payScreen redirect — the same hosted-checkout shape as every other
      // method. This is a merchant-facing setting, not a testability hook: it ships with the
      // module and merchants toggle it.
      MOLLIE_SANDBOX_IFRAME: '0',
      MOLLIE_SANDBOX_SINGLE_CLICK_PAYMENT: '0',
    });

    await this.seedPaymentMethods(shopCli);
    // `shopCli.clearCache()`, not `console('cache:clear')` as the spec's sketch has it: the
    // adapter's version runs in the prod environment and serialises across workers. A dev-env
    // clear fails outright once this module is installed — see NOTES.md §11.
    await shopCli.clearCache();
  }

  /**
   * The module renders one checkout option per enabled method, labelled with the method's
   * `description` as the Mollie API reports it — which is why the mock advertises the same
   * strings. 'creditcard' is labelled 'Card', so the mapping cannot be derived from the id.
   */
  paymentOptionLabel(method: string): string | RegExp {
    const seeded = SEEDED_METHODS.find((m) => m.id === method);
    if (!seeded) {
      throw new Error(
        `'${method}' is not one of the methods this implementation seeds (${this.methods.join(', ')}).`,
      );
    }
    return seeded.name;
  }

  /**
   * Drive the status-selection screen, then wait for the browser to come back to the shop.
   *
   * The same code serves both modes. Mollie's real test-mode screen and the mock's stand-in
   * expose the same contract — a radio per status plus a submit button — which is exactly why
   * the mock was built to mirror it (see `NOTES.md` §9).
   */
  async completeHostedCheckout(
    ctx: PspContext,
    { method, outcome }: CompleteHostedCheckoutOptions,
  ): Promise<HostedCheckoutResult> {
    const hostPattern =
      ctx.mode === 'sandbox' ? /mollie\.com\/(checkout|select-method)/ : /\/checkout\/(tr|ord)_/;
    await ctx.page.waitForURL(hostPattern, { timeout: 30_000 });

    // Read the transaction off the URL *before* driving the screen: it is the only handle on this
    // attempt that exists at this point, and for an unsuccessful outcome no order — and so no
    // confirmation page carrying a reference — will ever appear.
    const attempt = await this.attemptForCheckoutUrl(ctx);

    if (method === 'ideal' && ctx.mode === 'sandbox') {
      // Real iDEAL asks for an issuer before the status screen; the mock does not.
      const issuer = ctx.page.locator('.payment-method-list button, .payment-method-list a').first();
      if (await issuer.count()) await issuer.click();
    }

    const status = OUTCOME_TO_MOLLIE_STATUS[outcome];
    const option = ctx.page
      .getByRole('radio', { name: new RegExp(`^${status}$`, 'i') })
      .or(ctx.page.locator(`input[type="radio"][value="${status}"]`))
      .first();
    await expect(
      option,
      `The hosted checkout screen offers no '${status}' status to select`,
    ).toBeVisible();
    await option.check();

    await ctx.page
      .getByRole('button', { name: /continue|verder/i })
      .or(ctx.page.locator('.button.form__button'))
      .first()
      .click();

    // Back on the shop. The module's return page then waits for the webhook on its own, so this
    // must not wait for order confirmation — that would deadlock before ensureWebhookProcessed.
    await ctx.page.waitForURL(new RegExp(escapeForRegExp(hostOf(ctx.shopUrl))), {
      timeout: 30_000,
    });

    return { reference: attempt.reference, platformCartId: attempt.cartId };
  }

  /**
   * Make the module process the payment result.
   *
   * Mock mode: point the mock at the final status, then deliver the webhook exactly as Mollie
   * does — form-encoded `id`, no signature — to **the URL the module itself asked for**. That
   * URL carries the `security_token` the webhook controller requires (`webhook.php:71`), so
   * replaying it beats reconstructing it: nothing here has to know how the token is derived.
   *
   * Sandbox mode: the cloudflared tunnel means Mollie delivers the real webhook, so there is
   * nothing to send — poll until the order state reflects the outcome.
   */
  async ensureWebhookProcessed(
    ctx: PspContext,
    { orderReference, outcome, timeoutMs = 30_000 }: EnsureWebhookProcessedOptions,
  ): Promise<void> {
    if (ctx.mode !== 'mock') {
      // Sandbox: the cloudflared tunnel (§6.5) lets Mollie deliver the real webhook, so there is
      // nothing to send. The spec allows this to be a no-op that polls instead — and the poll
      // already exists one step later: `verifyOrderInBackOffice` re-reads the order state for up
      // to `timeoutMs`. Duplicating it here would only double the wait on a genuine failure.
      void timeoutMs;
      return;
    }

    const resource = await this.resourceForReference(orderReference);

    await fetchJson(`${MOCK_URL}/__admin/payments/${resource.id}/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: OUTCOME_TO_MOLLIE_STATUS[outcome] }),
    });

    if (!resource.webhookUrl) {
      throw new Error(
        `The module created ${resource.id} without a webhookUrl, so there is nothing to call. ` +
          'That is a module-side problem, not a test-side one.',
      );
    }

    await postWebhook({
      url: resource.webhookUrl,
      // The module reads `id` and fetches the real status from the API itself — the webhook body
      // carries no trusted state (`TransactionService`), which is why mocking the API is
      // necessary and mocking only the webhook would not be.
      body: `id=${resource.id}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // The controller answers 409 while another delivery for the same token holds the lock.
      expectStatus: [200, 201, 204, 409],
    });
  }

  /**
   * The order state the module sets for an outcome, or `null` when it creates no order at all.
   *
   * Verified mapping in `NOTES.md` §5. The `null` cases are the important part: the module only
   * creates the PrestaShop order once the payment status is *finished* — `paid`, `authorized`,
   * `completed`, `shipping`, `paid_backorder` (`MollieStatusUtility::isPaymentFinished`). For
   * `failed`, `canceled`, `expired` and `open` the webhook returns early and the cart stays a
   * cart, so "no order" is the correct expectation (DECISIONS.md D-015).
   *
   * Bank transfer is the exception: it pre-creates the order at payment initiation
   * (`controllers/front/payment.php:126`), so it always has a state to move.
   */
  expectedOrderState(outcome: HostedCheckoutOutcome, method?: string): string | null {
    const preCreatesOrder = method === 'banktransfer';

    switch (outcome) {
      case 'paid':
      case 'authorized':
        // MOLLIE_STATUS_PAID defaults to PS_OS_PAYMENT.
        return 'Payment accepted';
      case 'pending':
        // MOLLIE_STATUS_OPEN defaults to MOLLIE_STATUS_AWAITING, a module-installed state.
        return preCreatesOrder ? 'Awaiting Mollie payment' : null;
      case 'failed':
      case 'canceled':
      case 'expired':
        // MOLLIE_STATUS_CANCELED and MOLLIE_STATUS_EXPIRED both default to PS_OS_CANCELED.
        // Note this is 'Canceled', not the spec's invented 'Mollie payment canceled'.
        return preCreatesOrder ? 'Canceled' : null;
    }
  }

  /** `MOLLIE_STATUS_REFUNDED` → `PS_OS_REFUND`; partial refunds get the module's own state. */
  expectedRefundState(kind: 'full' | 'partial'): string {
    return kind === 'full' ? 'Refunded' : 'Partially refunded by Mollie';
  }

  /**
   * Drive the module's back-office refund widget.
   *
   * Every control below is an id the module already ships in
   * `views/templates/hook/order_info.tpl` and binds in `views/js/admin/order_info.js` — no
   * selectors were added to the module for testing, and none are needed. (The module's own Cypress
   * suite drives this panel through styled-components hashes like `.sc-htpNat`; those are build
   * output and would not survive a rebuild, so they are deliberately not used here.)
   *
   * Flow, from `order_info.js:166` and `:255`:
   *   full    → `#mollie-refund-all-orders` → modal → `#mollieRefundModalConfirm`
   *   partial → fill `#mollie-refund-amount` → `#mollie-initiate-refund` → same modal
   *
   * Refunding does **not** move the order state — that happens when the next webhook reports the
   * refund back (`TransactionService:200`), which is why the shared suites call
   * `ensureWebhookProcessed` afterwards.
   */
  async refundFromBackOffice(
    _ctx: PspContext,
    { admin }: { admin: AdminPanel },
    { reference, amount }: BackOfficeRefundOptions,
  ): Promise<void> {
    const orders = await admin.goToOrders();
    await orders.openOrder(reference);

    const panel = admin.page.locator('.mollie-order-info-panel');
    await expect(
      panel,
      `The Mollie panel did not render on the back-office page for order ${reference}. It is ` +
        'contributed by hookDisplayAdminOrder, so an empty page usually means the order is not a ' +
        'Mollie order at all.',
    ).toBeVisible({ timeout: 30_000 });

    // Both full and partial go through the amount field. The template pre-fills it with the full
    // refundable amount, so "full" is just "leave it alone" — and unlike `#mollie-refund-all-orders`
    // (which the template only enables for Orders-API orders with a shipment) this path exists for
    // every payment the module can refund.
    const amountField = panel.locator('#mollie-refund-amount');
    await expect(
      amountField,
      'The refund amount field is disabled, which the module does when nothing is refundable — ' +
        'either the payment is not paid, or it has already been refunded in full.',
    ).toBeEnabled();
    if (amount) {
      await amountField.fill(amount);
    }
    await panel.locator('#mollie-initiate-refund').click();

    const modal = admin.page.locator('#mollieRefundModal');
    await expect(modal, 'The refund confirmation modal did not open.').toBeVisible();
    await modal.locator('#mollieRefundModalConfirm').click();

    // `showSuccessMessage` prepends an .alert-success into the panel and fades it after 5s, so
    // this has to be observed promptly — and an .alert-danger is the module telling us the refund
    // failed, which deserves its own message rather than a generic timeout.
    const failure = panel.locator('.alert-danger');
    const success = panel.locator('.alert-success');
    await expect(async () => {
      if (await failure.count()) {
        throw new Error(
          `The module refused the refund for ${reference}: ` +
            `${(await failure.first().textContent())?.trim()}`,
        );
      }
      expect(await success.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
  }

  /** The mock's request log (spec §6.3a). Null in sandbox mode: there is no log in front of Mollie. */
  async apiCalls(ctx: PspContext, query: ApiCallsQuery = {}): Promise<ProviderApiCall[] | null> {
    if (ctx.mode !== 'mock') return null;

    const params = new URLSearchParams();
    if (query.since !== undefined) params.set('since', String(query.since));
    if (query.pathGlob) params.set('path', query.pathGlob);
    if (query.method) params.set('method', query.method);

    const result = await fetchJson<{ requests: ProviderApiCall[] }>(
      `${MOCK_URL}/__admin/requests?${params.toString()}`,
    );
    return result.requests;
  }

  /** Set the provider-side status without going through the hosted screen (mock mode only). */
  async forceProviderStatus(
    ctx: PspContext,
    { orderReference, outcome }: { orderReference: string; outcome: HostedCheckoutOutcome },
  ): Promise<void> {
    if (ctx.mode !== 'mock') {
      throw new Error('forceProviderStatus is a mock-mode facility; Mollie owns the real status.');
    }
    const resource = await this.resourceForReference(orderReference);
    await fetchJson(`${MOCK_URL}/__admin/payments/${resource.id}/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: OUTCOME_TO_MOLLIE_STATUS[outcome] }),
    });
  }

  // --- internals -------------------------------------------------------------------

  /**
   * Checkout options at the storefront come from `mol_payment_method` rows, not from
   * `Configuration` — `PaymentMethodRepository::getMethodsForCheckout` filters on `enabled = 1`.
   * The module writes those rows only from its back-office screen, after that screen has pulled
   * `GET /v2/methods/all`. Seeding them by SQL keeps setup fast and selector-free; the module's
   * own refresh path is covered by `e2e/specs/payment-methods.spec.ts` instead.
   */
  private async seedPaymentMethods(shopCli: PspSetupTools['shopCli']): Promise<void> {
    // Every numeric column is written explicitly, including the ones that look optional. The
    // module's amount restriction validator runs each of them through `prestashop/decimal`, which
    // throws on an empty string — and the module catches that, logs
    // `PaymentMethodRestrictionValidation has caught error: "" cannot be interpreted as a number`,
    // and silently drops the method from checkout. A NULL column therefore surfaces as
    // "Mollie offers no payment options" with no error anywhere near the cause.
    const values = SEEDED_METHODS.map(
      (method, index) =>
        `('${method.id}', '${escapeSql(method.name)}', 1, '${method.api}', '', 0, ` +
        `0, 0, 0, 0, 0, 0, 0, '{}', 0, 0, 0, ${index + 1}, 1, 0)`,
    ).join(',\n      ');

    await shopCli.sql(`
      DELETE FROM ps_mol_payment_method WHERE live_environment = 0;
      INSERT INTO ps_mol_payment_method
        (id_method, method_name, enabled, method, description, is_countries_applicable,
         minimal_order_value, max_order_value, surcharge, surcharge_fixed_amount_tax_excl,
         tax_rules_group_id, surcharge_percentage, surcharge_limit, images_json,
         min_amount, max_amount, is_manual_capture, position, id_shop, live_environment)
      VALUES
      ${values};
    `);

    // The payment option's displayed title comes from this table, one row per language, and an
    // absent row makes the option render with an empty name — which no locator can find.
    await shopCli.sql('DELETE FROM ps_mol_payment_method_translations;');
    for (const method of SEEDED_METHODS) {
      await shopCli.sql(
        `INSERT INTO ps_mol_payment_method_translations (id_method, id_lang, id_shop, text) ` +
          `SELECT '${method.id}', l.id_lang, 1, '${escapeSql(method.name)}' FROM ps_lang l;`,
      );
    }
  }

  /**
   * Resolve what we know about this attempt from the transaction id in the hosted-checkout URL.
   *
   * Both values come out of the metadata the module itself sent to Mollie when creating the
   * payment, so they are the module's own view of the attempt rather than the harness's guess.
   */
  private async attemptForCheckoutUrl(
    ctx: PspContext,
  ): Promise<{ reference: string | null; cartId: number | null }> {
    const match = ctx.page.url().match(/(tr|ord)_[A-Za-z0-9]+/);
    if (!match) return { reference: null, cartId: null };

    if (ctx.mode !== 'mock') {
      // Against real Mollie there is no control plane to ask; the confirmation page is the only
      // source, and unsuccessful sandbox outcomes therefore cannot be verified by reference.
      return { reference: null, cartId: null };
    }

    const resource = await fetchJson<MockResource>(
      `${MOCK_URL}/__admin/payments?id=${encodeURIComponent(match[0])}`,
    );
    return {
      reference: resource.orderReference,
      cartId: resource.cartId === null ? null : Number(resource.cartId),
    };
  }

  private async resourceForReference(reference: string): Promise<MockResource> {
    return fetchJson<MockResource>(
      `${MOCK_URL}/__admin/payments?ref=${encodeURIComponent(reference)}`,
    );
  }

}

function requireSecret(ctx: PspContext, name: string): string {
  const value = ctx.secrets[name];
  if (!value) {
    throw new Error(
      `Sandbox mode needs ${name}, which is not present in the environment. ` +
        'Declare it in psp.sandbox.requiredSecrets and provide it as a repository secret (§11).',
    );
  }
  return value;
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `Mollie mock control plane returned ${response.status} for ${url}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
