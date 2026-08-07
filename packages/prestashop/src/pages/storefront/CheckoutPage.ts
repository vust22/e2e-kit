import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';
import type { SeedAddress } from '../../seed/dataset.js';

/**
 * PrestaShop's five-step one-page checkout (`controller=order`).
 *
 * Steps collapse and expand in place rather than navigating, so every step method waits
 * for the *next* step to become active instead of waiting for a URL change.
 */
export class CheckoutPage extends BasePage {
  readonly personalInfoStep: Locator;
  readonly addressesStep: Locator;
  readonly deliveryStep: Locator;
  readonly paymentStep: Locator;
  readonly paymentOptions: Locator;
  readonly termsCheckbox: Locator;
  readonly placeOrderButton: Locator;
  readonly guestFormTab: Locator;

  constructor(page: Page) {
    super(page);
    // Locator preference order (spec §7.1): role > label > data-testid > stable id > CSS.
    this.personalInfoStep = this.locate('personalInfoStep', () =>
      page.locator('#checkout-personal-information-step'),
    );
    this.addressesStep = this.locate('addressesStep', () => page.locator('#checkout-addresses-step'));
    this.deliveryStep = this.locate('deliveryStep', () => page.locator('#checkout-delivery-step'));
    this.paymentStep = this.locate('paymentStep', () => page.locator('#checkout-payment-step'));
    this.paymentOptions = this.locate('paymentOptions', () => page.locator('.payment-options'));
    this.termsCheckbox = this.locate('termsCheckbox', () =>
      page.locator('#conditions-to-approve input[type="checkbox"]').first(),
    );
    this.placeOrderButton = this.locate('placeOrderButton', () =>
      page.locator('#payment-confirmation button[type="submit"]'),
    );
    this.guestFormTab = this.locate('guestFormTab', () =>
      page.locator('#checkout-guest-form, .js-customer-form').first(),
    );
  }

  /** intent: open checkout directly, bypassing the cart page */
  async goto(): Promise<void> {
    await this.page.goto('/index.php?controller=order');
  }

  /** intent: report which checkout step is currently expanded */
  async currentStep(): Promise<string> {
    const active = this.page.locator('#checkout .checkout-step.-current').first();
    return (await active.getAttribute('id')) ?? '';
  }

  /** intent: fill the guest identity form and advance past the personal-information step */
  async continueAsGuest(details: { firstName: string; lastName: string; email: string }): Promise<void> {
    await expect(this.personalInfoStep).toBeVisible();
    await this.personalInfoStep.locator('#field-firstname').fill(details.firstName);
    await this.personalInfoStep.locator('#field-lastname').fill(details.lastName);
    await this.personalInfoStep.locator('#field-email').fill(details.email);
    await this.personalInfoStep.locator('button[type="submit"][name="continue"]').click();
    await expect(this.addressesStep).toHaveClass(/-current|js-current-step/);
  }

  /** intent: fill a new delivery address and advance past the addresses step */
  async fillNewAddress(address: SeedAddress, countryName: string): Promise<void> {
    await expect(this.addressesStep).toBeVisible();
    const form = this.addressesStep;
    await form.locator('#field-address1').fill(address.address1);
    await form.locator('#field-postcode').fill(address.postcode);
    await form.locator('#field-city').fill(address.city);
    await form.locator('#field-phone').fill(address.phone);
    if (address.company) {
      const company = form.locator('#field-company');
      if (await company.count()) await company.fill(address.company);
    }
    await form.locator('#field-id_country').selectOption({ label: countryName });
    await form.locator('button[name="confirm-addresses"]').click();
    await expect(this.deliveryStep).toBeVisible();
  }

  /** intent: accept the already-selected saved address and advance to delivery */
  async confirmSavedAddress(): Promise<void> {
    await expect(this.addressesStep).toBeVisible();
    await this.addressesStep.locator('button[name="confirm-addresses"]').click();
    await expect(this.deliveryStep).toBeVisible();
  }

  /** intent: pick a carrier by its displayed name and advance to the payment step */
  async chooseCarrier(carrierName: string): Promise<void> {
    await expect(this.deliveryStep).toBeVisible();
    const option = this.deliveryStep
      .locator('.delivery-option')
      .filter({ hasText: carrierName })
      .first();
    await option.locator('input[type="radio"]').check();
    await this.deliveryStep.locator('button[name="confirmDeliveryOption"]').click();
    await expect(this.paymentStep).toBeVisible();
  }

  /** intent: accept whichever carrier is preselected and advance to the payment step */
  async confirmDefaultCarrier(): Promise<void> {
    await expect(this.deliveryStep).toBeVisible();
    await this.deliveryStep.locator('button[name="confirmDeliveryOption"]').click();
    await expect(this.paymentStep).toBeVisible();
  }

  /**
   * intent: select the payment option contributed by a module, e.g. 'mollie'
   *
   * A payment module may legitimately contribute several options — typically one per payment
   * method it offers. `label` narrows to one of them by its displayed name; only a module that
   * offers exactly one option can be selected without it.
   */
  async selectPaymentModule(moduleName: string, label?: string | RegExp): Promise<void> {
    await expect(this.paymentOptions).toBeVisible();
    const forModule = this.paymentOptions.locator(`input[data-module-name*="${moduleName}"]`);

    if (label === undefined) {
      const count = await forModule.count();
      // Zero options is a broken module; several with no label to pick between them is a broken
      // call. Both are worth saying out loud rather than timing out on a generic click.
      await expect(
        forModule,
        count > 1
          ? `Module '${moduleName}' offers ${count} payment options, so one has to be named. ` +
            'Pass a label, or implement paymentOptionLabel(method) on the PSP.'
          : `Expected exactly one payment option for module '${moduleName}'.`,
      ).toHaveCount(1);
      await forModule.check();
      return;
    }

    // PrestaShop renders each option as a row containing the radio and its label, so filtering
    // the row and then taking its input is what maps a displayed name back to a radio.
    const row = this.paymentOptions
      .locator('.payment-option')
      .filter({ has: this.page.locator(`input[data-module-name*="${moduleName}"]`) })
      .filter({ hasText: label });

    await expect(
      row,
      `Module '${moduleName}' offers no payment option labelled ${String(label)}.`,
    ).toHaveCount(1);
    await row.locator('input[type="radio"]').check();
  }

  /** intent: list the module names of every payment option currently offered */
  async availablePaymentModules(): Promise<string[]> {
    const inputs = this.paymentOptions.locator('input[data-module-name]');
    return (await inputs.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLInputElement).dataset.moduleName ?? ''),
    )).filter(Boolean);
  }

  /** intent: read the order total shown on the payment step, as the shop formats it */
  async totalText(): Promise<string> {
    const total = this.page
      .locator('#cart-summary .cart-total .value, .cart-summary-line.cart-total .value')
      .first();
    await expect(total).toBeVisible();
    return ((await total.textContent()) ?? '').trim();
  }

  /**
   * intent: accept terms and submit the order, landing on either PSP redirect or confirmation
   *
   * The button is not inside a form. PrestaShop's theme binds a delegated click handler that
   * submits the *selected* payment option's form, and that handler bails silently — no error, no
   * request, the page just sits there — if it cannot find a checked `payment-option` radio at the
   * moment of the click.
   *
   * Payment modules commonly refresh part of the payment step over ajax when the terms checkbox
   * or the selected option changes (Mollie refreshes the cart totals for payment fees). A click
   * that lands mid-refresh is the race this method exists to close: wait for the module's requests
   * to finish, re-assert that the option is still selected, and only then click.
   */
  async placeOrder(): Promise<void> {
    if (await this.termsCheckbox.count()) {
      await this.termsCheckbox.check();
    }

    const selectedOption = this.paymentOptions.locator('input[name="payment-option"]:checked');
    await expect(
      selectedOption,
      'No payment option is selected, so there is nothing to place an order with.',
    ).toHaveCount(1);

    // `networkidle` is normally a smell, but here it is the actual condition: the theme's handler
    // needs the option markup to have stopped being replaced, and a module's refresh is the only
    // thing replacing it. There is no shop-side element that says "the refresh finished".
    await this.page.waitForLoadState('networkidle');

    await expect(selectedOption, 'The payment option was deselected by a page refresh.').toBeChecked();
    await expect(this.placeOrderButton).toBeEnabled();
    await this.placeOrderButton.click();

    // The theme swallows a failed submit, so without this a broken checkout shows up much later
    // as a confusing timeout somewhere in the PSP implementation.
    await expect
      .poll(() => this.page.url(), {
        timeout: 20_000,
        message:
          'Placing the order did not navigate anywhere. The theme submits the selected payment ' +
          "option's form from a delegated click handler and fails silently when it cannot; check " +
          'that the module rendered a form for the selected option.',
      })
      .not.toMatch(/controller=order|\/order(\?|$)/);
  }
}
