import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

/** A single order's back-office detail page (`AdminOrders&vieworder`). */
export class AdminOrderDetailPage extends BasePage {
  readonly reference: Locator;
  readonly currentStateBadge: Locator;
  readonly stateSelect: Locator;
  readonly updateStateButton: Locator;
  readonly historyRows: Locator;
  readonly totalPaid: Locator;
  readonly refundButton: Locator;

  constructor(page: Page) {
    super(page);
    this.reference = this.locate('reference', () =>
      page.locator('#order_reference, .card-header:has-text("Order")').first(),
    );
    this.currentStateBadge = this.locate('currentStateBadge', () =>
      page.locator('#current_order_state, .order-status-label').first(),
    );
    this.stateSelect = this.locate('stateSelect', () =>
      page.locator('#update_order_status_action_input, #id_order_state').first(),
    );
    this.updateStateButton = this.locate('updateStateButton', () =>
      page.locator('#update_order_status_action_btn, button[name="submitState"]').first(),
    );
    this.historyRows = this.locate('historyRows', () => page.locator('#order-history-table tbody tr'));
    this.totalPaid = this.locate('totalPaid', () => page.locator('#orderTotal, .order-total').first());
    this.refundButton = this.locate('refundButton', () =>
      page.locator('#desc-order-standard_refund, button:has-text("Partial refund")').first(),
    );
  }

  /** intent: open an order's detail page directly by its numeric id */
  async goto(adminUrl: string, orderId: number): Promise<void> {
    await this.page.goto(`${adminUrl}&id_order=${orderId}&vieworder`);
    await expect(this.page.locator('#main')).toBeVisible();
  }

  /** intent: read the order state currently shown at the top of the page */
  async currentState(): Promise<string> {
    await expect(this.currentStateBadge).toBeVisible();
    return ((await this.currentStateBadge.textContent()) ?? '').trim();
  }

  /** intent: read every order-state name in the order's history, oldest first */
  async stateHistory(): Promise<string[]> {
    const count = await this.historyRows.count();
    const states: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await this.historyRows.nth(i).textContent()) ?? ''; // eslint-disable-line no-restricted-syntax -- FRAGILE: the history table has no per-row identifier to key on
      states.push(text.replace(/\s+/g, ' ').trim());
    }
    return states;
  }

  /** intent: move the order to a named state through the back-office control */
  async changeStateTo(stateName: string): Promise<void> {
    await expect(this.stateSelect).toBeVisible();
    await this.stateSelect.selectOption({ label: stateName });
    await this.updateStateButton.click();
    await expect(this.page.locator('.alert-success, #order-history-table')).toBeVisible();
  }

  /** intent: read the total the shop recorded as paid for this order */
  async totalPaidText(): Promise<string> {
    return ((await this.totalPaid.textContent()) ?? '').trim();
  }
}
