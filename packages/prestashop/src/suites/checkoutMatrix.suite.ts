import { pspContextFor, type E2EConfig } from '@invertus/e2e-core';
import { expect, test } from '../test.js';
import { checkoutWithProduct, payWith } from '../flows/checkout.js';
import { verifyOrderInBackOffice } from '../flows/backOffice.js';

/**
 * Shared suite `checkout-matrix` (spec §5.3, §6.3).
 *
 * One test per `method × outcome` from `psp.methodsUnderTest` and `psp.outcomesUnderTest`. That
 * declarative pair of lists is where most of a payment module's coverage comes from, and the
 * reason the kit holds no provider code: every provider-specific step below is a call into the
 * consumer's `PspContract`.
 *
 * Each test is `checkoutWithProduct` → `payWith(outcome)` → `psp.ensureWebhookProcessed` → verify.
 *
 * The verification splits on what `expectedOrderState` says the module does:
 *
 * - a state name → wait for the shop's order confirmation, read the reference it assigned, and
 *   assert the back-office order reached that state;
 * - `null` → assert **no order was created for this cart**. There is no reference to look up in
 *   that case, and that is the point: a module that only creates the order once the payment is
 *   final has nothing to show for a refused one (DECISIONS.md D-015).
 *
 * Both branches are positive assertions: a missing order fails the first, a stray order fails the
 * second.
 */
export function registerCheckoutMatrixSuite(config: E2EConfig): void {
  const psp = config.psp;
  if (!psp) {
    throw new Error(
      "Shared suite 'checkout-matrix' needs a `psp` block in e2e.config.ts — it generates one " +
        'test per method × outcome and has nothing to generate without one.',
    );
  }
  if (psp.methodsUnderTest.length === 0) {
    throw new Error("'checkout-matrix' needs at least one method in psp.methodsUnderTest.");
  }
  if (psp.outcomesUnderTest.length === 0) {
    throw new Error("'checkout-matrix' needs at least one outcome in psp.outcomesUnderTest.");
  }

  test.describe('shared: checkout-matrix', () => {
    for (const method of psp.methodsUnderTest) {
      for (const outcome of psp.outcomesUnderTest) {
        test(`${method} pays and settles as ${outcome}`, async ({
          page,
          storefront,
          admin,
          shopCli,
          psp: provider,
          shopEnv,
          e2eConfig,
        }) => {
          const ctx = pspContextFor(page, shopEnv, e2eConfig);
          const expectedState = provider.expectedOrderState(outcome, method);

          const checkout = await checkoutWithProduct(storefront);
          const attempt = await payWith(checkout, provider, outcome, { ctx, method });

          const attemptRef = attempt.reference ?? null;
          expect(
            attemptRef,
            `PSP '${provider.id}' reported no attempt key for ${method}/${outcome}. Return one from ` +
              'completeHostedCheckout — ensureWebhookProcessed is keyed by it.',
          ).not.toBeNull();

          await provider.ensureWebhookProcessed(ctx, {
            orderReference: attemptRef as string,
            outcome,
          });

          if (expectedState === null) {
            const cartId = attempt.platformCartId ?? null;
            expect(
              cartId,
              `PSP '${provider.id}' reported no platformCartId, so "no order was created" cannot ` +
                'be asserted without reading other tests\' orders too. Return it from ' +
                'completeHostedCheckout.',
            ).not.toBeNull();

            // Scoped to this cart, and polled rather than read once: the failure being guarded
            // against is an order arriving late from a webhook that should not have created one.
            await expect
              .poll(() => ordersForCart(shopCli, cartId as number | string), {
                timeout: 15_000,
                intervals: [1_000, 2_000, 3_000, 5_000],
                message:
                  `An order was created for cart ${cartId} (${method}/${outcome}), but ` +
                  `'${provider.id}' declares that this outcome produces none. Either the module ` +
                  'changed, or the outcome was not actually applied at the provider.',
              })
              .toBe(0);
            return;
          }

          // The shop assigns the order reference only when it creates the order, which happens
          // while the module's return page waits for the webhook — so the confirmation page is the
          // first place it exists (spec §7.4).
          await storefront.orderConfirmation.waitUntilVisible();
          const reference = await storefront.orderConfirmation.orderReference();

          await verifyOrderInBackOffice(admin, { reference, expectedState });
        });
      }
    }
  });
}

/** How many orders exist for one cart — the parallel-safe way to assert "no order was created". */
async function ordersForCart(
  shopCli: { sqlScalar(query: string): Promise<string | null> },
  cartId: number | string,
): Promise<number> {
  const value = await shopCli.sqlScalar(
    `SELECT COUNT(*) FROM ps_orders WHERE id_cart = ${Number(cartId)};`,
  );
  return Number(value ?? '0');
}
