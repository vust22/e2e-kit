import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

export class HomePage extends BasePage {
  readonly searchInput: Locator;
  readonly cartLink: Locator;
  readonly signInLink: Locator;
  readonly accountLink: Locator;

  constructor(page: Page) {
    super(page);
    // Locator preference order (spec §7.1): role > label > data-testid > stable id > CSS.
    this.searchInput = this.locate('searchInput', () =>
      page.getByRole('searchbox').or(page.locator('input[name="s"]')).first(),
    );
    this.cartLink = this.locate('cartLink', () => page.locator('#_desktop_cart a').first());
    // Friendly URLs are enabled in the seeded shop (spec §4.1 item 4), so links read
    // `/en/login`, not `?controller=authentication`. Match on the theme's own classes
    // instead of the query string, which changes shape with the URL mode.
    this.signInLink = this.locate('signInLink', () =>
      page.locator('#_desktop_user_info a:not(.account):not(.logout)').first(),
    );
    this.accountLink = this.locate('accountLink', () =>
      page.locator('#_desktop_user_info a.account').first(),
    );
  }

  /** intent: open the shop home page and wait until the storefront has rendered */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.locator('#header')).toBeVisible();
  }

  /** intent: report whether a customer session is currently signed in */
  async isSignedIn(): Promise<boolean> {
    return (await this.accountLink.count()) > 0;
  }

  /** intent: report how many items the header cart currently shows */
  async cartQuantity(): Promise<number> {
    const text = (await this.page.locator('.cart-products-count').first().textContent()) ?? '';
    const match = /(\d+)/.exec(text);
    return match?.[1] ? Number(match[1]) : 0;
  }
}
