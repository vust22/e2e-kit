import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

/** The back-office "Module Manager" page (`AdminModules`). */
export class AdminModulesPage extends BasePage {
  readonly searchInput: Locator;
  readonly moduleCards: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = this.locate('searchInput', () =>
      page.locator('#search-input-group input, input[name="search"]').first(),
    );
    this.moduleCards = this.locate('moduleCards', () => page.locator('.module-item'));
  }

  /** intent: locate the module manager card for a technical module name */
  cardFor(moduleName: string): Locator {
    return this.page.locator(`.module-item[data-tech-name="${moduleName}"]`).first();
  }

  /** intent: report whether the module appears as installed in the module manager */
  async isListed(moduleName: string): Promise<boolean> {
    return (await this.cardFor(moduleName).count()) > 0;
  }

  /** intent: open a module's configuration screen from the module manager */
  async configure(moduleName: string): Promise<void> {
    const card = this.cardFor(moduleName);
    await expect(card).toBeVisible();
    await card.locator('a[href*="configure="]').first().click();
    await this.page.waitForURL(/configure=/);
  }
}
