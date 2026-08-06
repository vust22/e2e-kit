import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

export class CartPage extends BasePage {
  readonly items: Locator;
  readonly total: Locator;
  readonly proceedToCheckoutButton: Locator;
  readonly emptyCartNotice: Locator;

  constructor(page: Page) {
    super(page);
    this.items = this.locate('items', () => page.locator('.cart-item'));
    this.total = this.locate('total', () => page.locator('.cart-total .value').first());
    // Friendly URLs make this `/en/order`; the non-friendly form is `?controller=order`.
    this.proceedToCheckoutButton = this.locate('proceedToCheckoutButton', () =>
      page.locator('.checkout a.btn-primary, .checkout a[href*="order"]').first(),
    );
    this.emptyCartNotice = this.locate('emptyCartNotice', () =>
      page.locator('.no-items'),
    );
  }

  /** intent: open the shopping cart page */
  async goto(): Promise<void> {
    await this.page.goto('/index.php?controller=cart&action=show');
  }

  /** intent: report how many distinct lines the cart contains */
  async lineCount(): Promise<number> {
    return this.items.count();
  }

  /** intent: read the cart's grand total as displayed to the customer */
  async totalText(): Promise<string> {
    return ((await this.total.textContent()) ?? '').trim();
  }

  /** intent: move from the cart to the first step of checkout */
  async proceedToCheckout(): Promise<void> {
    await expect(this.proceedToCheckoutButton).toBeVisible();
    await this.proceedToCheckoutButton.click();
    await this.page.waitForURL(/controller=order|\/order(\b|$)/);
  }
}
