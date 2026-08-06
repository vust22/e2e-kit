import { expect, type Locator, type Page } from '@invertus/e2e-core';
import { BasePage } from '../BasePage.js';

/**
 * The page a customer lands on after a successful order.
 *
 * The order reference is what every downstream verification flow keys on, so
 * {@link OrderConfirmationPage.orderReference} is deliberately strict: it fails loudly
 * rather than returning an empty string that would turn into a confusing back-office
 * "order not found" three steps later.
 */
export class OrderConfirmationPage extends BasePage {
  readonly container: Locator;
  readonly heading: Locator;
  readonly detailsList: Locator;
  readonly total: Locator;

  constructor(page: Page) {
    super(page);
    this.container = this.locate('container', () => page.locator('#content-hook_order_confirmation'));
    this.heading = this.locate('heading', () => page.locator('#content-hook_order_confirmation h3').first());
    this.detailsList = this.locate('detailsList', () => page.locator('#order-details'));
    this.total = this.locate('total', () =>
      page.locator('#order-summary-content .total-value, .order-confirmation-table .total-value').first(),
    );
  }

  /** intent: wait until the confirmation page has rendered for a completed order */
  async waitUntilVisible(): Promise<void> {
    await this.page.waitForURL(/controller=order-confirmation|\/order-confirmation/);
    await expect(this.container).toBeVisible();
  }

  /** intent: read the numeric order id the shop assigned, taken from the confirmation URL */
  orderId(): number | null {
    const match = /[?&]id_order=(\d+)/.exec(this.page.url());
    return match?.[1] ? Number(match[1]) : null;
  }

  /** intent: read the human order reference used by back-office verification flows */
  async orderReference(): Promise<string> {
    // PrestaShop renders the reference inside the order details list; the label is
    // translatable, so match the reference format rather than the surrounding words.
    const detailsText = (await this.detailsList.textContent()) ?? '';
    const fromDetails = /\b([A-Z]{9})\b/.exec(detailsText);
    if (fromDetails?.[1]) return fromDetails[1];

    const bodyText = (await this.container.textContent()) ?? '';
    const fromBody = /\b([A-Z]{9})\b/.exec(bodyText);
    if (fromBody?.[1]) return fromBody[1];

    throw new Error(
      'Could not read an order reference from the confirmation page. ' +
        `URL was ${this.page.url()}. Details block: ${detailsText.slice(0, 300)}`,
    );
  }

  /** intent: read the order total as displayed to the customer */
  async totalText(): Promise<string> {
    return ((await this.total.textContent()) ?? '').trim();
  }
}
