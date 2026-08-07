import type { E2EConfig } from '@invertus/e2e-core';
import { expect, test } from '../test.js';
import { verifyOrderInBackOffice } from '../flows/backOffice.js';

/**
 * Shared suite `back-office-verify` (spec §5.3, §6.3).
 *
 * §6.3 describes back-office verification as "folded into checkout verification", and it is —
 * `checkout-matrix` already asserts the state of every outcome. What is *not* covered there is
 * the back office's own rendering of a successful order: that the row is findable, the total
 * survived the round trip through the provider, and the module's panel reports the transaction
 * it actually created.
 *
 * So this suite is deliberately narrow. It runs one paid checkout and then interrogates the
 * back-office order in the ways the matrix does not, rather than duplicating the matrix.
 */
export function registerBackOfficeVerifySuite(config: E2EConfig): void {
  const psp = config.psp;
  if (!psp) {
    throw new Error(
      "Shared suite 'back-office-verify' needs a `psp` block in e2e.config.ts — it verifies a " +
        'provider-paid order in the back office.',
    );
  }

  const method = firstMethod(psp.methodsUnderTest);

  test.describe('shared: back-office-verify', () => {
    test('a paid order is findable in the back office with the amount that was charged', async ({
      storefront,
      admin,
      testOrder,
      psp: provider,
    }) => {
      const { reference } = await testOrder.createPaidOrder({ method });
      const chargedTotal = await storefront.orderConfirmation.totalText();

      // The total is the assertion that matters here: it is the one value that travels shop →
      // provider → shop, so a currency or tax mistake in the module surfaces as a mismatch and
      // nowhere else.
      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: provider.expectedOrderState('paid', method) as string,
        expectedTotal: chargedTotal,
      });
    });

    test('the order detail page shows the provider transaction for the order', async ({
      admin,
      testOrder,
      psp: provider,
    }) => {
      const { reference } = await testOrder.createPaidOrder({ method });

      await verifyOrderInBackOffice(admin, {
        reference,
        expectedState: provider.expectedOrderState('paid', method) as string,
      });

      const orders = await admin.goToOrders();
      await orders.openOrder(reference);

      // PrestaShop records the provider's transaction id on the order's payment row regardless
      // of which module made it, so this is platform knowledge and belongs in the kit. Whatever
      // richer panel the module contributes is the consumer's own spec to assert.
      await expect(
        admin.orderDetail.paymentMethodText(),
        `Back-office order ${reference} does not name the payment module that created it`,
      ).resolves.toMatch(new RegExp(provider.id, 'i'));
    });
  });
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
