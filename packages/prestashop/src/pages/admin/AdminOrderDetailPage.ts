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

  /**
   * intent: read the order state the back office currently shows for this order
   *
   * Read from the selected option of the status dropdown. PS 8 has no standalone state badge on
   * the order page — `#current_order_state` does not exist — and the dropdown is pre-selected to
   * the current state, so it is both present and correct on every version checked.
   */
  async currentState(): Promise<string> {
    if (await this.currentStateBadge.count()) {
      return ((await this.currentStateBadge.textContent()) ?? '').trim();
    }

    await expect(
      this.stateSelect,
      'Neither an order-state badge nor the status dropdown is on this page, so the current ' +
        'order state cannot be read. Is this actually an order detail page?',
    ).toBeVisible();
    return (
      await this.stateSelect.locator('option:checked').first().textContent()
    )?.trim() ?? '';
  }

  /**
   * intent: read every order-state name in the order's history, oldest first
   *
   * Throws when the history table is absent rather than returning `[]`. An empty array here would
   * make "the history did not change" assertions pass without reading anything at all — a false
   * green, which is worse than a failure.
   */
  async stateHistory(): Promise<string[]> {
    const count = await this.historyRows.count();
    if (count === 0) {
      throw new Error(
        'No order-history rows found on the order page. The history table id differs on this ' +
          'PrestaShop version; assert on the order_history table through ShopCli instead of ' +
          'reading the page.',
      );
    }
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

    // Assert the state actually changed, rather than that a confirmation banner appeared. The
    // order page carries a permanently hidden `#ajax_confirmation` alert that any
    // `.alert-success` locator picks up, so banner-watching here is both ambiguous and beside the
    // point — the state is what the caller cares about.
    await expect
      .poll(() => this.currentState(), {
        timeout: 20_000,
        message: `The order never moved to '${stateName}' after the back-office state change.`,
      })
      .toContain(stateName);
  }

  /**
   * intent: read the payment method PrestaShop recorded for this order
   *
   * PrestaShop stores the paying module's display name on the order regardless of which module
   * it was, so this is platform knowledge. Whatever richer panel a module contributes to the
   * page is that module's own spec to assert.
   */
  async paymentMethodText(): Promise<string> {
    const cell = this.page
      .locator('#orderPaymentsBlock, #order-payment-tab, .order-payments')
      .first();
    if (await cell.count()) {
      return ((await cell.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    }
    // PS 8 and PS 9 disagree on the payments block id, and the order page has no `#main` wrapper —
    // the page body is the only container guaranteed to exist on both.
    return ((await this.page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  }

  /** intent: read the total the shop recorded as paid for this order */
  async totalPaidText(): Promise<string> {
    return ((await this.totalPaid.textContent()) ?? '').trim();
  }
}
