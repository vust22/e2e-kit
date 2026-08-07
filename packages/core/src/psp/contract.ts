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

/** What driving the external screen told us about the attempt. */
export interface HostedCheckoutResult {
  /**
   * The key `ensureWebhookProcessed` will be called with for this attempt.
   *
   * This is a **provider-side** handle, not the platform's order reference. The two are often
   * different: a module typically sends the provider a placeholder of its own at payment-creation
   * time — no platform order exists yet — and the platform assigns the real reference only once
   * the payment settles. Modules that never create an order for a refused payment never assign one
   * at all.
   *
   * The PSP implementation is the only party standing on the provider's page, so it is the only
   * one that can produce this — typically from the transaction id in the URL. Shared suites read
   * the *platform* order reference from the confirmation page instead (spec §7.4).
   */
  reference?: string | null;

  /**
   * The platform cart this attempt belongs to, when the module tells the provider about it.
   *
   * The only identifier that exists for an attempt which will never become an order, and the one
   * thing that makes "no order was created" a parallel-safe assertion: scoped to this cart it
   * cannot see another test's order.
   */
  platformCartId?: number | string | null;
}

export interface EnsureWebhookProcessedOptions {
  orderReference: string;
  outcome: HostedCheckoutOutcome;
  timeoutMs?: number;
}

/** One request the provider actually received, as reported by a provider mock's request log. */
export interface ProviderApiCall {
  method: string;
  /** Path only, no query string, e.g. `/v2/payments/tr_e2e0001/refunds`. */
  path: string;
  /** Parsed request body, when the mock could parse one. */
  body?: unknown;
  /** Epoch milliseconds, for `since` filtering. */
  at: number;
}

export interface ApiCallsQuery {
  /** Only calls at or after this epoch-millisecond timestamp. */
  since?: number;
  /** Glob over the path, e.g. `/v2/payments/*\/refunds`. */
  pathGlob?: string;
  method?: string;
}

export interface BackOfficeRefundOptions {
  /** Platform order reference to refund. */
  reference: string;
  /** Amount for a partial refund, as a plain decimal string. Omit for a full refund. */
  amount?: string;
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
  ): Promise<HostedCheckoutResult | void>;

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
   * Map an outcome to the platform order state NAME the module is expected to set,
   * e.g. 'paid' -> 'Payment accepted'. Used by shared verification flows.
   *
   * Return `null` when the outcome legitimately produces **no order at all** — the normal
   * result of an abandoned or refused payment for modules that only create the order once the
   * payment is final. `null` is still a positive assertion: the shared suites verify that no
   * order appeared, so a stray order is a failure (DECISIONS.md D-015).
   *
   * `method` is passed because the answer can depend on it: a method that pre-creates the order
   * at payment initiation (bank transfer, typically) has a state to check for every outcome,
   * while a redirect method has none until the payment succeeds.
   */
  expectedOrderState(outcome: HostedCheckoutOutcome, method?: string): string | null;

  // --- Optional capabilities -------------------------------------------------------
  //
  // Shared suites use these when a provider implementation offers them and skip the
  // scenarios that need them when it does not. That is what keeps back-office order
  // management a *shared* suite (spec §6.3a) while the module-specific parts of it —
  // driving a module's own refund widget, reading a provider mock's request log — stay
  // where provider knowledge belongs (DECISIONS.md D-017).

  /**
   * How the module labels the checkout payment option for a method.
   *
   * Needed whenever the module contributes more than one option — most payment modules offer one
   * per method — because the module name alone cannot pick between them. The kit cannot infer it:
   * 'creditcard' may well be labelled 'Card'.
   */
  paymentOptionLabel?(method: string): string | RegExp;

  /**
   * Drive the module's own back-office refund control, if it contributes one.
   *
   * Resolves when the module reports the refund succeeded. It must NOT wait for the order
   * state to change: many modules move the state only when the provider's next webhook
   * arrives, which is `ensureWebhookProcessed`'s job.
   */
  refundFromBackOffice?(
    ctx: PspContext,
    tools: { admin: AdminPanel },
    opts: BackOfficeRefundOptions,
  ): Promise<void>;

  /**
   * The provider API calls received so far, for asserting that a back-office action really
   * reached the provider (spec §6.3a).
   *
   * Mock mode only — there is no request log in front of a real provider. Return `null` when
   * unavailable so suites can skip rather than fail.
   */
  apiCalls?(ctx: PspContext, query?: ApiCallsQuery): Promise<ProviderApiCall[] | null>;

  /**
   * The order state name the module sets after a refund settles.
   *
   * Separate from `expectedOrderState` because a refund is not a hosted-checkout outcome: it
   * happens to an order that is already paid. Defaults are deliberately absent — a module that
   * has a refund UI knows what state it moves to.
   */
  expectedRefundState?(kind: 'full' | 'partial'): string;

  /** Point the provider's stored state at `status` without going through its UI (mock mode). */
  forceProviderStatus?(
    ctx: PspContext,
    opts: { orderReference: string; outcome: HostedCheckoutOutcome },
  ): Promise<void>;
}

/** A class implementing {@link PspContract}, as referenced from `e2e.config.ts`. */
export type PspConstructor = new () => PspContract;
