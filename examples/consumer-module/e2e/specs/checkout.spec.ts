import { expect, test } from '@invertus/e2e-prestashop';
import { checkoutWithProduct, payWithCheckPayment } from '@invertus/e2e-prestashop/flows';
import { SEED } from '@invertus/e2e-prestashop/seed';

/**
 * The Phase 1 acceptance path (spec §12): a complete storefront purchase against the
 * seeded shop, paid with PrestaShop's bundled check payment, verified in the back office.
 *
 * No PSP is involved anywhere here — that is the point. It proves the shared flows,
 * the seed dataset and the environment work before any provider enters the picture.
 */

// Check payment ships disabled in the seeded image (DECISIONS.md D-010), so the suite
// that wants it turns it on for itself.
test.beforeAll(async ({ shopCli }) => {
  await shopCli.exec(['e2e-config', 'module-active', 'ps_checkpayment', '1']);
  await shopCli.clearCache();
});

test.describe('storefront checkout', () => {
  test('a signed-in customer can buy a seeded product and reach order confirmation', async ({
    storefront,
  }) => {
    const checkout = await checkoutWithProduct(storefront, {
      productId: SEED.products.TSHIRT.id,
      quantity: 1,
    });

    await expect(checkout.paymentOptions).toBeVisible();

    const reference = await payWithCheckPayment(storefront);

    expect(reference, 'confirmation page did not yield an order reference').toMatch(/^[A-Z]{9}$/);
  });

  test('the order created at checkout is visible in the back office', async ({
    storefront,
    admin,
  }) => {
    await checkoutWithProduct(storefront, { productId: SEED.products.MUG.id });
    const reference = await payWithCheckPayment(storefront);

    const orders = await admin.goToOrders();
    await orders.searchByReference(reference);
    await expect(
      orders.rowForReference(reference),
      `order ${reference} is missing from the back-office grid`,
    ).toBeVisible();
  });

  test('an out-of-stock product cannot be added to the cart', async ({ storefront }) => {
    await storefront.product.goto(SEED.products.OUT_OF_STOCK.id);

    expect(
      await storefront.product.isAddToCartEnabled(),
      'the out-of-stock seed product offered an enabled add-to-cart button',
    ).toBe(false);
  });
});

test.describe('seeded shop', () => {
  test('the seeded catalogue is present with the ids the dataset promises', async ({ shopCli }) => {
    const rows = await shopCli.sql(
      'SELECT id_product, reference FROM ps_product ORDER BY id_product',
    );
    const actual = rows
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));

    const expected = Object.values(SEED.products).map((p) => [String(p.id), p.reference]);
    expect(actual).toEqual(expected);
  });

  test('the module renders its storefront banner on the home page', async ({ storefront }) => {
    await storefront.goHome();
    await expect(storefront.page.getByTestId('e2e-home-consumer-banner')).toBeVisible();
  });
});
