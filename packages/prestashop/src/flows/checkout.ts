import { expect, type HostedCheckoutOutcome, type PspContext, type PspContract } from '@invertus/e2e-core';
import type { Storefront } from '../facades/Storefront.js';
import type { CheckoutPage } from '../pages/storefront/CheckoutPage.js';
import { DEFAULT_PRODUCT, SEED, type SeedCustomer } from '../seed/dataset.js';

/** Display names of the seeded countries, as PrestaShop renders them in the address form. */
const COUNTRY_NAMES: Record<string, string> = {
  LT: 'Lithuania',
  NL: 'Netherlands',
  DE: 'Germany',
};

export interface CheckoutWithProductOptions {
  productId?: number;
  quantity?: number;
  /** Check out without an account. Defaults to false — signed-in is faster and steadier. */
  guest?: boolean;
  customer?: SeedCustomer;
  /** Carrier to select by displayed name. Defaults to whichever is preselected. */
  carrierName?: string;
}

/**
 * Drive the storefront from an empty cart to the payment step (spec §3.5).
 *
 * Returns the checkout page parked on the payment step, so the caller decides how payment
 * happens — that split is what lets one flow serve every payment module.
 */
export async function checkoutWithProduct(
  storefront: Storefront,
  opts: CheckoutWithProductOptions = {},
): Promise<CheckoutPage> {
  const productId = opts.productId ?? DEFAULT_PRODUCT.id;
  const quantity = opts.quantity ?? 1;
  const customer = opts.customer ?? SEED.customers.RETAIL;

  if (!opts.guest) {
    await storefront.signInAs(customer);
  }

  await storefront.product.goto(productId);
  if (quantity !== 1) {
    await storefront.product.setQuantity(quantity);
  }
  await storefront.product.addToCart();
  await storefront.product.proceedToCheckout();
  await storefront.cart.proceedToCheckout();

  const checkout = storefront.checkout;

  if (opts.guest) {
    await checkout.continueAsGuest({
      firstName: SEED.guest.firstName,
      lastName: SEED.guest.lastName,
      email: uniqueGuestEmail(),
    });
    const countryName = COUNTRY_NAMES[customer.address.countryIso];
    if (!countryName) {
      throw new Error(
        `No display name known for country ${customer.address.countryIso}. Add it to COUNTRY_NAMES.`,
      );
    }
    await checkout.fillNewAddress(customer.address, countryName);
  } else {
    await checkout.confirmSavedAddress();
  }

  if (opts.carrierName) {
    await checkout.chooseCarrier(opts.carrierName);
  } else {
    await checkout.confirmDefaultCarrier();
  }

  await expect(checkout.paymentOptions).toBeVisible();
  return checkout;
}

/**
 * Guest checkouts must not collide with each other: PrestaShop refuses a guest email that
 * already belongs to an account, so a fixed address would make the second run in a job
 * fail for reasons that have nothing to do with the module under test (spec §7.4).
 */
let guestCounter = 0;
function uniqueGuestEmail(): string {
  guestCounter += 1;
  const [local, domain] = SEED.guest.email.split('@');
  return `${local}+${process.pid}-${guestCounter}@${domain}`;
}

/**
 * Complete an order with PrestaShop's bundled "Payments by check" module.
 *
 * This is platform knowledge, not provider knowledge, so it belongs in the kit: it is how
 * the kit exercises a full checkout with no PSP involved at all — the Phase 1 acceptance
 * path and the fallback for non-payment consumer modules.
 *
 * The module is disabled in the seeded image (DECISIONS.md D-010); enable it first with
 * `shopCli.exec(['e2e-config', 'module-active', 'ps_checkpayment', '1'])`.
 */
export async function payWithCheckPayment(storefront: Storefront): Promise<string> {
  const checkout = storefront.checkout;
  await checkout.selectPaymentModule('ps_checkpayment');
  await checkout.placeOrder();

  // ps_checkpayment interposes its own confirmation screen before the order is created.
  const confirmButton = storefront.page.getByRole('link', { name: /i confirm my order/i })
    .or(storefront.page.locator('#content-hook_payment_return, .ps-shown-by-js button[type="submit"]'))
    .first();
  if (await confirmButton.count()) {
    await confirmButton.click().catch(() => undefined);
  }

  await storefront.orderConfirmation.waitUntilVisible();
  return storefront.orderConfirmation.orderReference();
}

export interface PayWithOptions {
  /** Provider method id, e.g. 'ideal'. Defaults to the PSP's first declared method. */
  method?: string;
  /** The PSP context for this page; build it with `pspContextFor` from the kit fixtures. */
  ctx: PspContext;
}

/**
 * Select the PSP's payment option, place the order, and hand the external screen to the
 * provider implementation (spec §3.5).
 *
 * Note: the spec's signature is `(checkout, psp, outcome)`. `PspContract.completeHostedCheckout`
 * needs a `PspContext`, which only the fixtures can build, so it is passed explicitly
 * here rather than reconstructed from environment variables inside the flow.
 */
export async function payWith(
  checkout: CheckoutPage,
  psp: PspContract,
  outcome: HostedCheckoutOutcome,
  opts: PayWithOptions,
): Promise<void> {
  const method = opts.method ?? psp.methods[0];
  if (!method) {
    throw new Error(`PSP '${psp.id}' declares no methods, so there is nothing to pay with.`);
  }

  await checkout.selectPaymentModule(psp.id);
  await checkout.placeOrder();
  await psp.completeHostedCheckout(opts.ctx, { method, outcome });
}
