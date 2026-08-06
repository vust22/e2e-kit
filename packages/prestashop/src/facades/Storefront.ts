import { expect, type Page, type ShopEnvironment, type Storefront as CoreStorefront } from '@invertus/e2e-core';
import { CartPage } from '../pages/storefront/CartPage.js';
import { CheckoutPage } from '../pages/storefront/CheckoutPage.js';
import { HomePage } from '../pages/storefront/HomePage.js';
import { OrderConfirmationPage } from '../pages/storefront/OrderConfirmationPage.js';
import { ProductPage } from '../pages/storefront/ProductPage.js';
import { SEED, type SeedCustomer } from '../seed/dataset.js';

/** Facade over the storefront page objects, plus customer sign-in. */
export class Storefront implements CoreStorefront {
  readonly page: Page;
  readonly home: HomePage;
  readonly product: ProductPage;
  readonly cart: CartPage;
  readonly checkout: CheckoutPage;
  readonly orderConfirmation: OrderConfirmationPage;

  constructor(page: Page, private readonly env: ShopEnvironment) {
    this.page = page;
    this.home = new HomePage(page);
    this.product = new ProductPage(page);
    this.cart = new CartPage(page);
    this.checkout = new CheckoutPage(page);
    this.orderConfirmation = new OrderConfirmationPage(page);
  }

  get shopUrl(): string {
    return this.env.shopUrl;
  }

  /** Navigate to the shop home page. */
  async goHome(): Promise<void> {
    await this.home.goto();
  }

  /**
   * Sign in as a seeded customer.
   *
   * Signing in rather than checking out as a guest is the default for shared flows: it
   * removes the personal-information step and reuses the seeded address, which makes the
   * checkout both faster and less selector-dependent.
   */
  async signInAs(customer: SeedCustomer = SEED.customers.RETAIL): Promise<void> {
    await this.page.goto('/index.php?controller=authentication&back=my-account');
    // Already authenticated from an earlier action in this test. With friendly URLs on,
    // the landing URL is `/en/my-account`, not `?controller=my-account`.
    if (/\/my-account/.test(this.page.url())) return;

    await this.page.locator('#login-form input[name="email"]').fill(customer.email);
    await this.page.locator('#login-form input[name="password"]').fill(customer.password);
    await this.page.locator('#submit-login').click();
    await expect(
      this.page.locator('#_desktop_user_info a.account').first(),
      `Sign-in as ${customer.email} did not produce an authenticated session`,
    ).toBeVisible();
  }

  /** Sign the current customer out, if any. */
  async signOut(): Promise<void> {
    await this.page.goto('/index.php?controller=my-account');
    const logout = this.page.locator('a[href*="mylogout"]').first();
    if (await logout.count()) {
      await logout.click();
    }
  }
}
