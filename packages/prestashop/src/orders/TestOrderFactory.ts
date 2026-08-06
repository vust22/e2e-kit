import type {
  CreateOrderOptions,
  HostedCheckoutOutcome,
  TestOrderFactory as CoreTestOrderFactory,
  TestOrderFactoryDeps,
  TestOrderRef,
} from '@invertus/e2e-core';
import type { AdminPanel } from '../facades/AdminPanel.js';
import type { Storefront } from '../facades/Storefront.js';
import { checkoutWithProduct, payWithCheckPayment } from '../flows/checkout.js';

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
 * `viaCheckout` is the high-fidelity path and is what Phase 1 ships. The fast paths
 * (`createOrder`, `createPaidOrder`) short-circuit the browser by driving the shop's HTTP
 * endpoints and the provider mock directly; they need a mock service to set payment
 * status against, so they arrive with the Mollie pilot in Phase 3.
 */
export class PrestaShopTestOrderFactory implements CoreTestOrderFactory {
  private readonly storefront: Storefront;
  private readonly admin: AdminPanel;

  constructor(deps: TestOrderFactoryDeps) {
    this.storefront = deps.storefront as Storefront;
    this.admin = deps.admin as AdminPanel;
  }

  /** Full browser checkout: slowest, highest fidelity. */
  async viaCheckout(opts: ViaCheckoutOptions = {}): Promise<TestOrderRef> {
    await checkoutWithProduct(this.storefront, opts);

    const paymentModule = opts.paymentModule ?? 'ps_checkpayment';
    if (paymentModule !== 'ps_checkpayment') {
      throw new Error(
        `testOrder.viaCheckout cannot drive '${paymentModule}' on its own — an external ` +
          'payment screen needs the PSP implementation. Use checkoutWithProduct + payWith instead.',
      );
    }

    const reference = await payWithCheckPayment(this.storefront);
    const orderId = this.storefront.orderConfirmation.orderId();

    return orderId === null ? { reference } : { reference, orderId };
  }

  async createOrder(outcome: HostedCheckoutOutcome, _opts: CreateOrderOptions = {}): Promise<TestOrderRef> {
    throw new Error(
      `testOrder.createOrder('${outcome}') is not implemented yet. The fast order path needs a ` +
        'provider mock to set payment status against; it lands with the Mollie pilot (spec §6.3a, Phase 3). ' +
        'Use testOrder.viaCheckout() until then.',
    );
  }

  async createPaidOrder(opts: CreateOrderOptions = {}): Promise<TestOrderRef> {
    return this.createOrder('paid', opts);
  }

  /** The back office, for tests that want to inspect the order they just made. */
  get backOffice(): AdminPanel {
    return this.admin;
  }
}
