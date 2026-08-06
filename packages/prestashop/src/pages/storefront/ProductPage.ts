import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

export class ProductPage extends BasePage {
  readonly title: Locator;
  readonly price: Locator;
  readonly quantityInput: Locator;
  readonly addToCartButton: Locator;
  readonly availability: Locator;
  readonly cartModal: Locator;
  readonly proceedToCheckoutButton: Locator;
  readonly continueShoppingButton: Locator;

  constructor(page: Page) {
    super(page);
    this.title = this.locate('title', () => page.locator('h1[itemprop="name"]').first());
    this.price = this.locate('price', () => page.locator('.current-price-value').first());
    this.quantityInput = this.locate('quantityInput', () => page.locator('#quantity_wanted'));
    this.addToCartButton = this.locate('addToCartButton', () =>
      page.locator('button[data-button-action="add-to-cart"]'),
    );
    this.availability = this.locate('availability', () => page.locator('#product-availability'));
    this.cartModal = this.locate('cartModal', () => page.locator('#blockcart-modal'));
    this.proceedToCheckoutButton = this.locate('proceedToCheckoutButton', () =>
      page.locator('#blockcart-modal a[href*="cart"]').first(),
    );
    this.continueShoppingButton = this.locate('continueShoppingButton', () =>
      page.locator('#blockcart-modal button.btn-secondary'),
    );
  }

  /** intent: open the product detail page for a seeded product id */
  async goto(productId: number): Promise<void> {
    await this.page.goto(`/index.php?controller=product&id_product=${productId}&id_lang=1`);
    await expect(this.addToCartButton).toBeVisible();
  }

  /** intent: set how many units of this product the customer wants */
  async setQuantity(quantity: number): Promise<void> {
    await this.quantityInput.fill(String(quantity));
    // PrestaShop recalculates on blur; without it the value can be ignored on submit.
    await this.quantityInput.blur();
  }

  /** intent: add the product to the cart and wait for the confirmation modal */
  async addToCart(): Promise<void> {
    await this.addToCartButton.click();
    await expect(this.cartModal).toBeVisible();
  }

  /** intent: report whether the product can currently be ordered */
  async isAddToCartEnabled(): Promise<boolean> {
    return this.addToCartButton.isEnabled();
  }

  /** intent: leave the add-to-cart modal and continue to the cart page */
  async proceedToCheckout(): Promise<void> {
    await this.proceedToCheckoutButton.click();
    await this.page.waitForURL(/controller=cart|\/cart/);
  }
}
