import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

export class AdminLoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = this.locate('emailInput', () => page.locator('#email'));
    this.passwordInput = this.locate('passwordInput', () => page.locator('#passwd'));
    this.submitButton = this.locate('submitButton', () => page.locator('#submit_login'));
    this.errorAlert = this.locate('errorAlert', () => page.locator('.alert-danger'));
  }

  /** intent: open the back-office login screen */
  async goto(adminPath: string): Promise<void> {
    await this.page.goto(`${adminPath}/index.php`);
  }

  /** intent: report whether the browser is currently sitting on the login screen */
  async isDisplayed(): Promise<boolean> {
    return (await this.emailInput.count()) > 0;
  }

  /** intent: sign in with the given employee credentials and wait for the dashboard */
  async signIn(email: string, password: string): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
    await this.page.waitForURL(/controller=AdminDashboard|token=/);
  }
}
