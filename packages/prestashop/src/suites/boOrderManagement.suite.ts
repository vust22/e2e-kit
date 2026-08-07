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
 * Shared suite `bo-order-management` (spec §6.3a).
 *
 * Interception happens at the provider's API boundary, so mock-mode checkouts create **real**
 * PrestaShop orders — real `orders`/`order_history` rows, real module tables, real state
 * transitions. Only the provider's responses are fake. That is what makes back-office order
 * management fully testable without a real provider, and why this is a shared suite rather than
 * a per-module one.
 *
 * Each scenario asserts the back-office outcome *and*, where the action should reach the
 * provider, the outbound call itself via `psp.apiCalls`. The pairing matters: a module that
 * renders "Refund was made successfully" without calling anyone would pass a UI-only assertion.
 *
 * Scenarios needing a capability the PSP does not implement skip with a reason rather than fail —
 * the suite is shared, the capabilities are optional (DECISIONS.md D-017).
 */
export function registerBoOrderManagementSuite(config: E2EConfig): void {
  const psp = config.psp;
  if (!psp) {
    throw new Error(
      "Shared suite 'bo-order-management' needs a `psp` block in e2e.config.ts — every scenario " +
        'starts from a provider-paid order.',
    );
  }

  test.describe('shared: bo-order-management', () => {
    test.beforeEach(async ({ shopEnv }) => {
      test.skip(
        shopEnv.mode !== 'mock',
        'Back-office order management runs in mock mode (spec §6.3a): the scenarios assert the ' +
          'provider request log, which only a mock has.',
      );
    });

    test('a full refund from the back office refunds the order at the provider', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference, providerPaymentId } = await testOrder.createPaidOrder();

      const since = Date.now();
      await issueRefund({ ctx, admin, provider, reference });

      const calls = await refundCalls(provider, ctx, since);
      if (calls) {
        expect(calls.length, 'no refund call reached the provider').toBeGreaterThanOrEqual(1);
        expect(amountsOf(calls), 'the refund call did not carry the full order amount').toContain(
          await orderTotalDigits(admin, reference),
        );
      }

      await provider.ensureWebhookProcessed(ctx, {
        orderReference: providerPaymentId as string,
        outcome: 'paid',
      });
      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: refundState(provider, 'full'),
      });
    });

    test('two partial refunds each produce their own provider call and sum correctly', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference, providerPaymentId } = await testOrder.createPaidOrder();

      const since = Date.now();
      await issueRefund({ ctx, admin, provider, reference, amount: '1.00' });
      await issueRefund({ ctx, admin, provider, reference, amount: '2.00' });

      const calls = await refundCalls(provider, ctx, since);
      if (calls) {
        expect(calls.length, 'each partial refund should produce one provider call').toBe(2);
        expect(amountsOf(calls)).toEqual(expect.arrayContaining(['1.00', '2.00']));
      }

      await provider.ensureWebhookProcessed(ctx, {
        orderReference: providerPaymentId as string,
        outcome: 'paid',
      });
      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: refundState(provider, 'partial'),
      });
    });

    test('an unpaid order can be canceled in the back office', async ({
      admin,
      testOrder,
      psp: provider,
    }) => {
      const pendingState = provider.expectedOrderState('pending');
      test.skip(
        pendingState === null,
        `PSP '${provider.id}' creates no order for a pending payment, so there is nothing to ` +
          'cancel in the back office.',
      );

      const { reference } = await testOrder.createOrder('pending');
      await verifyOrderInBackOffice(admin, { reference, expectedState: pendingState as string });

      const orders = await admin.goToOrders();
      await orders.openOrder(reference);
      await admin.orderDetail.changeStateTo('Canceled');

      await verifyOrderInBackOffice(admin, { reference, expectedState: 'Canceled' });
    });

    test('a manual state change to Shipped makes no provider calls', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference } = await testOrder.createPaidOrder();

      const orders = await admin.goToOrders();
      await orders.openOrder(reference);

      // The window starts after the order page has loaded, so the assertion covers the state
      // change alone and not the page's own provider reads.
      const since = Date.now();
      await admin.orderDetail.changeStateTo('Shipped');
      await verifyOrderInBackOffice(admin, { reference, expectedState: 'Shipped' });

      const calls = await provider.apiCalls?.(ctx, { since });
      if (calls) {
        const mutating = calls.filter((call) => call.method !== 'GET');
        expect(
          mutating.map((call) => `${call.method} ${call.path}`),
          'a plain shop-side state change must not send anything to the provider',
        ).toEqual([]);
      }
    });

    test('re-delivering the same webhook does not duplicate order history', async ({
      page,
      shopCli,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference, providerPaymentId } = await testOrder.createPaidOrder();

      // Counted in the database, not read off the page: the order page's history table is not
      // reliably present across PrestaShop versions, and an assertion that silently reads nothing
      // would pass no matter what the module did.
      const historyRows = async () =>
        Number(
          (await shopCli.sqlScalar(
            `SELECT COUNT(*) FROM ps_order_history oh
             JOIN ps_orders o ON o.id_order = oh.id_order
             WHERE o.reference = '${reference}';`,
          )) ?? '0',
        );

      const before = await historyRows();
      expect(before, 'the paid order has no history rows at all').toBeGreaterThan(0);

      // The order was already settled by createPaidOrder; this is the same webhook again.
      await provider.ensureWebhookProcessed(ctx, {
        orderReference: providerPaymentId as string,
        outcome: 'paid',
      });

      expect(
        await historyRows(),
        'a repeated webhook added order-history rows — the module is not idempotent',
      ).toBe(before);
    });

    test('the order detail page reports the provider transaction that paid it', async ({
      page,
      admin,
      testOrder,
      psp: provider,
      shopEnv,
      e2eConfig,
    }) => {
      const ctx = pspContextFor(page, shopEnv, e2eConfig);
      const { reference } = await testOrder.createPaidOrder();

      const orders = await admin.goToOrders();
      await orders.openOrder(reference);

      const shown = await admin.orderDetail.paymentMethodText();
      expect(
        shown,
        `Back-office order ${reference} does not name '${provider.id}' as the payer`,
      ).toMatch(new RegExp(provider.id, 'i'));

      // And the provider's own record agrees the payment is settled.
      const calls = await provider.apiCalls?.(ctx, { method: 'POST', pathGlob: '/v2/*' });
      if (calls) {
        expect(
          calls.length,
          'the order exists but no payment was ever created at the provider',
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });
}

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

/** `null` when the implementation exposes no request log; callers then skip the assertion. */
async function refundCalls(
  provider: PspContract,
  ctx: PspContext,
  since: number,
): ReturnType<NonNullable<PspContract['apiCalls']>> {
  if (!provider.apiCalls) return null;
  return provider.apiCalls(ctx, { since, method: 'POST', pathGlob: '*/refunds' });
}

function amountsOf(calls: { body?: unknown }[]): (string | undefined)[] {
  return calls.map((call) => {
    if (typeof call.body !== 'object' || call.body === null) return undefined;
    const amount = (call.body as { amount?: { value?: unknown } }).amount;
    return typeof amount?.value === 'string' ? amount.value : undefined;
  });
}

/** The order total as the provider would have received it: a plain two-decimal string. */
async function orderTotalDigits(admin: AdminPanel, reference: string): Promise<string> {
  const orders = await admin.goToOrders();
  await orders.openOrder(reference);
  const text = await admin.orderDetail.totalPaidText();
  const match = text.match(/(\d+)[.,](\d{2})/);
  if (!match) {
    throw new Error(`Could not read a total out of the back-office order page text: '${text}'`);
  }
  return `${match[1]}.${match[2]}`;
}

function refundState(provider: PspContract, kind: 'full' | 'partial'): string {
  const state = provider.expectedRefundState?.(kind);
  if (!state) {
    throw new Error(
      `PSP '${provider.id}' drives back-office refunds but does not implement ` +
        "expectedRefundState(). Add it so the back-office suite knows which state to expect.",
    );
  }
  return state;
}
