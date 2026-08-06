import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

/**
 * A module's own configuration screen.
 *
 * Deliberately generic: every module renders a different form, so this exposes the
 * PrestaShop-level scaffolding (the form, the save button, the result alerts) and lets
 * the consumer's `configureModule` callback drive the fields it knows about.
 */
export class ModuleConfigPage extends BasePage {
  readonly form: Locator;
  readonly saveButton: Locator;
  readonly successAlert: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.form = this.locate('form', () => page.locator('form[id*="module"], #module_form, form').first());
    this.saveButton = this.locate('saveButton', () =>
      page.getByRole('button', { name: /save/i }).first(),
    );
    this.successAlert = this.locate('successAlert', () => page.locator('.alert-success'));
    this.errorAlert = this.locate('errorAlert', () => page.locator('.alert-danger'));
  }

  /** intent: fill a configuration field identified by its form input name */
  async fillField(name: string, value: string): Promise<void> {
    const field = this.page.locator(`[name="${name}"]`).first();
    await expect(field).toBeVisible();
    await field.fill(value);
  }

  /** intent: choose an option in a configuration dropdown identified by its input name */
  async selectField(name: string, value: string): Promise<void> {
    await this.page.locator(`select[name="${name}"]`).first().selectOption(value);
  }

  /** intent: switch a configuration toggle identified by its input name on or off */
  async setToggle(name: string, enabled: boolean): Promise<void> {
    const input = this.page.locator(`input[name="${name}"][value="${enabled ? '1' : '0'}"]`).first();
    await input.check();
  }

  /** intent: submit the configuration form and assert the module reported success */
  async save(): Promise<void> {
    await this.saveButton.click();
    await expect(this.successAlert).toBeVisible();
  }

  /** intent: read the current value of a configuration field */
  async fieldValue(name: string): Promise<string> {
    return this.page.locator(`[name="${name}"]`).first().inputValue();
  }
}
