import type { Page } from '@playwright/test';
import type { AdminPanel, ShopCli } from '../platform/types.js';

/** The outcome the test wants the external payment to produce. */
export type HostedCheckoutOutcome =
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'pending'
  | 'authorized';

export const HOSTED_CHECKOUT_OUTCOMES: readonly HostedCheckoutOutcome[] = [
  'paid',
  'failed',
  'canceled',
  'expired',
  'pending',
  'authorized',
] as const;

export interface PspContext {
  page: Page;
  shopUrl: string;
  /** From env `E2E_PSP_MODE`. */
  mode: 'mock' | 'sandbox';
  /** Provider secrets, resolved from env (spec §11). Empty in mock mode by design. */
  secrets: Record<string, string>;
}

export interface PspSetupTools {
  admin: AdminPanel;
  shopCli: ShopCli;
}

export interface CompleteHostedCheckoutOptions {
  method: string;
  outcome: HostedCheckoutOutcome;
}

export interface EnsureWebhookProcessedOptions {
  orderReference: string;
  outcome: HostedCheckoutOutcome;
  timeoutMs?: number;
}

export interface PspContract {
  /** Unique id, lowercase, matches the module's payment option, e.g. 'mollie'. */
  readonly id: string;

  /**
   * Payment methods this implementation can exercise, e.g. ['ideal','creditcard','banktransfer'].
   * The kit generates a test per method when the consumer opts in (spec §5.3 methodsUnderTest).
   */
  readonly methods: string[];

  /**
   * Called once before the suite. Configure the module for the current mode
   * (e.g. write test API keys via ShopCli or the module config page).
   */
  setup(ctx: PspContext, tools: PspSetupTools): Promise<void>;

  /**
   * Invoked after CheckoutPage.placeOrder(). The browser is either already on the
   * provider's external page or about to navigate there. Drive that external page
   * (or the mock's stand-in page) to produce `outcome`, then wait until the browser
   * is back on `shopUrl`. Must be resilient to the redirect not having happened yet:
   * use page.waitForURL with a provider-host pattern first.
   */
  completeHostedCheckout(
    ctx: PspContext,
    opts: CompleteHostedCheckoutOptions,
  ): Promise<void>;

  /**
   * Deliver (or trigger) the provider's server-to-server webhook for the given
   * payment so the module updates the order state, WITHOUT relying on the provider
   * actually calling us. In mock mode: POST directly to the module's webhook endpoint
   * (use signWebhook/postWebhook helpers if the provider signs). In sandbox mode: may
   * be a no-op if the tunnel delivers real webhooks — then this method just polls
   * until the order state reflects the outcome.
   */
  ensureWebhookProcessed(
    ctx: PspContext,
    opts: EnsureWebhookProcessedOptions,
  ): Promise<void>;

  /**
   * Map an outcome to the PrestaShop order state NAME the module is expected to set,
   * e.g. 'paid' -> 'Payment accepted', 'failed' -> 'Payment error'. Used by shared
   * verification flows.
   */
  expectedOrderState(outcome: HostedCheckoutOutcome): string;
}

/** A class implementing {@link PspContract}, as referenced from `e2e.config.ts`. */
export type PspConstructor = new () => PspContract;
