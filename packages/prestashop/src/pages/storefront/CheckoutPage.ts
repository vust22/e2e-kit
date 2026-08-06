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

  /** intent: select the payment option whose module name matches, e.g. 'mollie' */
  async selectPaymentModule(moduleName: string): Promise<void> {
    await expect(this.paymentOptions).toBeVisible();
    const option = this.paymentOptions.locator(`input[data-module-name*="${moduleName}"]`);
    // A module that renders zero or several payment options is a real product bug, not a
    // locator problem — say so rather than timing out on a generic click.
    await expect(
      option,
      `Expected exactly one payment option for module '${moduleName}'.`,
    ).toHaveCount(1);
    await option.check();
  }

  /** intent: list the module names of every payment option currently offered */
  async availablePaymentModules(): Promise<string[]> {
    const inputs = this.paymentOptions.locator('input[data-module-name]');
    return (await inputs.evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLInputElement).dataset.moduleName ?? ''),
    )).filter(Boolean);
  }

  /** intent: accept terms and submit the order, landing on either PSP redirect or confirmation */
  async placeOrder(): Promise<void> {
    if (await this.termsCheckbox.count()) {
      await this.termsCheckbox.check();
    }
    await expect(this.placeOrderButton).toBeEnabled();
    await this.placeOrderButton.click();
  }
}
