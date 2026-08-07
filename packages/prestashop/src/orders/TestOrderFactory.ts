import type {
  CreateOrderOptions,
  HostedCheckoutOutcome,
  PspContext,
  PspContract,
  TestOrderFactory as CoreTestOrderFactory,
  TestOrderFactoryDeps,
  TestOrderRef,
} from '@invertus/e2e-core';
import type { Page } from '@invertus/e2e-core';
import type { AdminPanel } from '../facades/AdminPanel.js';
import type { Storefront } from '../facades/Storefront.js';
import { checkoutWithProduct, payWith, payWithCheckPayment } from '../flows/checkout.js';

export interface ViaCheckoutOptions extends CreateOrderOptions {
  /**
   * Which payment option to use. Defaults to PrestaShop's bundled check payment, which
   * needs no provider at all — the right default for tests that just need *an* order.
   */
  paymentModule?: string;
}

/**
 * Produces isolated order state per test (spec §7.4, §6.3a).
 *
 * Two ways to get an order:
 *
 * - `viaCheckout` — the full browser checkout. Highest fidelity, and what `checkout-matrix`
 *   uses, because the thing under test *is* the checkout.
 * - `createOrder(outcome)` / `createPaidOrder()` — order supply for tests whose subject is
 *   something else (back-office management, mostly). The guarantee is a **real** order in the
 *   requested state: real `orders`/`order_history` rows, real module tables, real state
 *   transitions. Only the provider's responses are fake.
 *
 * On speed: §6.3a targets <5s per order for the second path, on the assumption that cart
 * creation and payment initiation can be driven over HTTP without a browser session. They
 * cannot, for PrestaShop — the cart is bound to a front-office session, and the module's
 * payment controller resolves the cart from that session. Rather than reimplement PrestaShop's
 * session handshake in the kit, `createOrder` drives the same browser checkout and delegates the
 * provider legs to the PSP. It is correct, it is the documented guarantee, and it is slower than
 * the target — see DECISIONS.md D-018.
 */
export class PrestaShopTestOrderFactory implements CoreTestOrderFactory {
  private readonly storefront: Storefront;
  private readonly admin: AdminPanel;
  private readonly psp: PspContract | null;
  private readonly buildPspContext: (page: Page) => PspContext;

  constructor(deps: TestOrderFactoryDeps) {
    this.storefront = deps.storefront as Storefront;
    this.admin = deps.admin as AdminPanel;
    this.psp = deps.psp;
    this.buildPspContext = deps.pspContext;
  }

  /** Full browser checkout: slowest, highest fidelity. */
  async viaCheckout(opts: ViaCheckoutOptions = {}): Promise<TestOrderRef> {
    await checkoutWithProduct(this.storefront, opts);

    const paymentModule = opts.paymentModule ?? 'ps_checkpayment';
    if (paymentModule !== 'ps_checkpayment') {
      throw new Error(
        `testOrder.viaCheckout cannot drive '${paymentModule}' on its own — an external ` +
          'payment screen needs the PSP implementation. Use createOrder(outcome) instead, or ' +
          'checkoutWithProduct + payWith when the checkout itself is what you are testing.',
      );
    }

    const reference = await payWithCheckPayment(this.storefront);
    const orderId = this.storefront.orderConfirmation.orderId();

    return orderId === null ? { reference } : { reference, orderId };
  }

  /**
   * An order paid through the configured provider, settled to `outcome`.
   *
   * Includes the webhook delivery, so the returned order is already in the state the module
   * assigns for that outcome — a test can go straight to asserting back-office behaviour.
   */
  async createOrder(
    outcome: HostedCheckoutOutcome,
    opts: CreateOrderOptions = {},
  ): Promise<TestOrderRef> {
    const psp = this.psp;
    if (!psp) {
      throw new Error(
        `testOrder.createOrder('${outcome}') needs a provider, but e2e.config.ts declares no ` +
          '`psp` block. Use testOrder.viaCheckout() for an order that needs no provider.',
      );
    }

    const ctx = this.buildPspContext(this.storefront.page);
    const method = opts.method ?? psp.methods[0];
    if (!method) {
      throw new Error(`PSP '${psp.id}' declares no methods, so there is nothing to pay with.`);
    }

    const checkout = await checkoutWithProduct(this.storefront, opts);
    const attempt = await payWith(checkout, psp, outcome, { ctx, method });

    const attemptRef = attempt.reference;
    if (!attemptRef) {
      throw new Error(
        `PSP '${psp.id}' reported no attempt key, so the payment cannot be settled. ` +
          'Return one from completeHostedCheckout.',
      );
    }

    await psp.ensureWebhookProcessed(ctx, { orderReference: attemptRef, outcome });

    if (psp.expectedOrderState(outcome, method) === null) {
      throw new Error(
        `testOrder.createOrder('${outcome}') cannot return an order: '${psp.id}' declares that ` +
          `this outcome creates none for '${method}'. Use the checkout-matrix suite to assert that ` +
          'behaviour instead.',
      );
    }

    // The attempt key is provider-side — for Mollie a `mol_…` placeholder. The shop assigns its
    // own reference only when it creates the order, so the confirmation page is the first place
    // the real one exists (spec §7.4). Passing the attempt key to a back-office lookup instead is
    // the single most expensive mistake available here: it fails 15s later as "no order row
    // found", which reads like a missing order rather than a wrong key.
    await this.storefront.orderConfirmation.waitUntilVisible();
    const reference = await this.storefront.orderConfirmation.orderReference();

    return { reference, providerPaymentId: attemptRef };
  }

  async createPaidOrder(opts: CreateOrderOptions = {}): Promise<TestOrderRef> {
    return this.createOrder('paid', opts);
  }

  /** The back office, for tests that want to inspect the order they just made. */
  get backOffice(): AdminPanel {
    return this.admin;
  }
}
