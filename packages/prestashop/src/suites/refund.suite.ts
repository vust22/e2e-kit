import {
  pspContextFor,
  type E2EConfig,
  type PspContext,
  type PspContract,
} from '@invertus/e2e-core';
import { expect, test } from '../test.js';
import type { AdminPanel } from '../facades/AdminPanel.js';
import { refundOrder, verifyOrderInBackOffice } from '../flows/backOffice.js';

/**
 * Shared suite `refund` (spec §3.5, §6.3).
 *
 * Mock mode covers full and partial refunds; sandbox mode covers the full refund only, because a
 * real provider's test environment charges real rate limits for the second call and the partial
 * path is already proven against the mock.
 *
 * Refunding is two steps in most payment modules and the suite reflects that honestly:
 * the back-office action tells the provider to refund, and the order state moves only when the
 * provider's next webhook reports the refund back. Collapsing them would hide a real class of
 * module bug — a refund that reaches the provider but never updates the shop.
 */
export function registerRefundSuite(config: E2EConfig): void {
  const psp = config.psp;
  if (!psp) {
    throw new Error(
      "Shared suite 'refund' needs a `psp` block in e2e.config.ts — it refunds a provider payment.",
    );
  }

  const method = firstMethod(psp.methodsUnderTest);

  test.describe('shared: refund', () => {
    test('a full refund from the back office reaches the provider and settles the order', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference, providerPaymentId } = await testOrder.createPaidOrder({ method });

      const since = Date.now();
      await issueRefund({ ctx, admin, provider, reference });

      await expectProviderRefundCall({ ctx, provider, since, expectedAmount: null });

      // The refund only becomes an order state once the provider says so — and the provider is
      // keyed by its own attempt id, not by the shop's reference (see HostedCheckoutResult).
      await provider.ensureWebhookProcessed(ctx, {
        orderReference: providerPaymentId as string,
        outcome: 'paid',
      });
      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: refundState(provider, 'full'),
      });
    });

    test('two partial refunds sum to the full amount', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      test.skip(
        shopEnv.mode === 'sandbox',
        'Partial refunds run in mock mode only (spec §6.3): the sandbox path is rate-limited and ' +
          'the full refund already covers the provider round trip.',
      );

      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference, providerPaymentId } = await testOrder.createPaidOrder({ method });

      const firstSince = Date.now();
      await issueRefund({ ctx, admin, provider, reference, amount: '1.00' });
      await expectProviderRefundCall({ ctx, provider, since: firstSince, expectedAmount: '1.00' });

      await provider.ensureWebhookProcessed(ctx, {
        orderReference: providerPaymentId as string,
        outcome: 'paid',
      });
      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: refundState(provider, 'partial'),
      });

      const secondSince = Date.now();
      await issueRefund({ ctx, admin, provider, reference, amount: '2.00' });
      await expectProviderRefundCall({ ctx, provider, since: secondSince, expectedAmount: '2.00' });

      const calls = await provider.apiCalls?.(ctx, { pathGlob: '*/refunds', method: 'POST' });
      if (calls) {
        expect(
          calls.length,
          'both partial refunds should have produced their own provider call',
        ).toBeGreaterThanOrEqual(2);
      }
    });
  });
}

/** Through the module's own refund widget when it has one, otherwise PrestaShop's. */
async function issueRefund(args: {
  ctx: PspContext;
  admin: AdminPanel;
  provider: PspContract;
  reference: string;
  amount?: string;
}): Promise<void> {
  if (args.provider.refundFromBackOffice) {
    await args.provider.refundFromBackOffice(
      args.ctx,
      { admin: args.admin },
      { reference: args.reference, amount: args.amount },
    );
    return;
  }
  await refundOrder(args.admin, {
    reference: args.reference,
    partial: args.amount ? { amount: args.amount } : undefined,
  });
}

/**
 * Assert the refund actually left the shop. Without this a module that renders a success message
 * and calls nothing would pass — the exact bug §6.3a asks for a request-log assertion to catch.
 */
async function expectProviderRefundCall(args: {
  ctx: PspContext;
  provider: PspContract;
  since: number;
  expectedAmount: string | null;
}): Promise<void> {
  if (!args.provider.apiCalls) return;

  const calls = await args.provider.apiCalls(args.ctx, {
    since: args.since,
    pathGlob: '*/refunds',
    method: 'POST',
  });
  // `null` means the implementation has no request log in this mode (sandbox); that is a
  // documented gap, not a failure.
  if (calls === null) return;

  expect(
    calls.length,
    'the back-office refund reported success but no refund call reached the provider',
  ).toBeGreaterThanOrEqual(1);

  if (args.expectedAmount) {
    const amounts = calls.map((call) => amountOf(call.body));
    expect(
      amounts,
      `no refund call carried the requested amount ${args.expectedAmount}`,
    ).toContain(args.expectedAmount);
  }
}

/**
 * A module with a refund UI must say what state a settled refund lands in; guessing a name would
 * turn a wrong guess into a 30-second timeout with a misleading message.
 */
function refundState(provider: PspContract, kind: 'full' | 'partial'): string {
  const state = provider.expectedRefundState?.(kind);
  if (!state) {
    throw new Error(
      `PSP '${provider.id}' drives back-office refunds but does not implement ` +
        "expectedRefundState(). Add it so the 'refund' suite knows which order state to expect.",
    );
  }
  return state;
}

function amountOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const amount = (body as { amount?: { value?: unknown } }).amount;
  return typeof amount?.value === 'string' ? amount.value : undefined;
}

/** The suite exercises one representative method; the matrix is what covers them all. */
function firstMethod(methods: readonly string[]): string {
  const method = methods[0];
  if (!method) {
    throw new Error(
      'psp.methodsUnderTest is empty, so there is no payment method to exercise. ' +
        'Add at least one method, or drop this suite from suites.shared.',
    );
  }
  return method;
}
