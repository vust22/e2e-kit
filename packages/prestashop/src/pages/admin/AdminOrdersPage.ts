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

  /**
   * intent: read the order-state label shown in the grid for a reference
   *
   * Targets the status column explicitly. Taking "the last cell with text" instead reads the
   * actions column, whose content is an icon ligature — the assertion then compares an order
   * state against the string `zoom_in`, which is a confusing way to learn the locator is wrong.
   */
  async stateForReference(reference: string): Promise<string> {
    const row = this.rowForReference(reference);
    await expect(row).toBeVisible();

    const statusCell = row
      .locator('td.column-osname, td[class*="osname"], td.column-status')
      .first();
    if (await statusCell.count()) {
      return ((await statusCell.textContent()) ?? '').trim();
    }

    // PS 8 and PS 9 name the column differently across grid revisions; the state is always the
    // cell carrying the coloured badge.
    const badgeCell = row.locator('td:has(.badge), td:has(span[class*="label"])').first();
    if (await badgeCell.count()) {
      return ((await badgeCell.textContent()) ?? '').trim();
    }

    throw new Error(
      `Could not find a status column in the orders grid row for ${reference}. ` +
        'The grid markup changed; update AdminOrdersPage.stateForReference.',
    );
  }

  /** intent: locate the grid row belonging to an order reference */
  rowForReference(reference: string): Locator {
    return this.rows.filter({ hasText: reference }).first();
  }

  /**
   * intent: open the detail page of the order with the given reference
   *
   * The grid links to the Symfony route `.../orders/{id}/view`, not to the legacy
   * `AdminOrders&vieworder` URL — the legacy form only survives as a `_legacy_link` alias in the
   * routing config. Matching both keeps this working across PS 8 and PS 9, and across the
   * legacy/migrated grid the shop happens to render.
   */
  async openOrder(reference: string): Promise<void> {
    await this.searchByReference(reference);
    const row = this.rowForReference(reference);
    await expect(row).toBeVisible();

    // Navigate by href rather than clicking it. The grid row carries several links — a preview
    // toggle, per-row actions, a dropdown — and clicking "the first one that looks like a view
    // link" lands on whichever the markup happens to order first, which may not navigate at all.
    // Reading the href and going there is unambiguous, and it is still the link the UI offers.
    // Constrained to the *order* view route on purpose. A grid row also links to the customer
    // (`/sell/customers/2/view`), and a looser `a[href*="/view"]` picks that up first — landing on
    // the customer page, where the assertion then fails for a reason that has nothing to do with
    // orders.
    const viewLink = row
      .locator(
        'a.grid-view-row-link, a[href*="/sell/orders/"][href*="/view"], a[href*="vieworder"]',
      )
      .first();
    await expect(
      viewLink,
      `The grid row for ${reference} has no link to the order. The orders grid markup changed; ` +
        'update AdminOrdersPage.openOrder.',
    ).toHaveCount(1);


    const href = await viewLink.getAttribute('href');
    if (!href) {
      throw new Error(`The order link for ${reference} has no href.`);
    }
    await this.page.goto(new URL(href, this.page.url()).toString());

    // Assert on the order itself rather than on a layout container: the back office wraps the
    // order page differently across PS 8 and PS 9, but the reference is on the page either way,
    // and it is what proves we landed on the *right* order.
    await expect(
      this.page.locator('body'),
      `Navigated to the order page for ${reference}, but the page does not mention that reference.`,
    ).toContainText(reference, { timeout: 20_000 });
  }
}
