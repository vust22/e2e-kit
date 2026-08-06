import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

/** The back-office orders grid (`AdminOrders`). */
export class AdminOrdersPage extends BasePage {
  readonly grid: Locator;
  readonly referenceFilter: Locator;
  readonly searchButton: Locator;
  readonly rows: Locator;
  readonly emptyRow: Locator;

  constructor(page: Page) {
    super(page);
    this.grid = this.locate('grid', () => page.locator('#order_grid_table'));
    this.referenceFilter = this.locate('referenceFilter', () =>
      page.locator('#order_reference'),
    );
    this.searchButton = this.locate('searchButton', () =>
      page.locator('#order_grid .grid-search-button, button[name="order[actions][search]"]').first(),
    );
    this.rows = this.locate('rows', () => page.locator('#order_grid_table tbody tr'));
    this.emptyRow = this.locate('emptyRow', () => page.locator('#order_grid_table tbody tr.empty-row'));
  }

  /** intent: filter the orders grid down to a single order reference */
  async searchByReference(reference: string): Promise<void> {
    await expect(this.referenceFilter).toBeVisible();
    await this.referenceFilter.fill(reference);
    await this.referenceFilter.press('Enter');
    await expect(this.grid).toBeVisible();
  }

  /** intent: read the order-state label shown in the grid for a reference */
  async stateForReference(reference: string): Promise<string> {
    const row = this.rowForReference(reference);
    await expect(row).toBeVisible();
    return ((await row.locator('td').filter({ hasText: /.+/ }).last().textContent()) ?? '').trim();
  }

  /** intent: locate the grid row belonging to an order reference */
  rowForReference(reference: string): Locator {
    return this.rows.filter({ hasText: reference }).first();
  }

  /** intent: open the detail page of the order with the given reference */
  async openOrder(reference: string): Promise<void> {
    await this.searchByReference(reference);
    const row = this.rowForReference(reference);
    await expect(row).toBeVisible();
    await row.locator('a[href*="vieworder"]').first().click();
    await this.page.waitForURL(/vieworder/);
  }
}
