import { expect } from '@invertus/e2e-core';
import type { AdminPanel } from '../facades/AdminPanel.js';
import type { ModuleConfigPage } from '../pages/admin/ModuleConfigPage.js';

export interface VerifyOrderOptions {
  reference?: string;
  orderId?: number;
  /** Expected order-state NAME, e.g. 'Payment accepted'. */
  expectedState: string;
  /** Expected total as displayed, e.g. '€24.98'. Compared loosely on digits. */
  expectedTotal?: string;
  /** How long to keep re-reading the state; webhooks are eventually consistent. */
  timeoutMs?: number;
}

/**
 * Find an order in the back office and assert its state (spec §3.5).
 *
 * The state is polled rather than read once: an order's state is set by a webhook that
 * arrives independently of the browser, so a single read races the shop (spec §7.3).
 */
export async function verifyOrderInBackOffice(
  admin: AdminPanel,
  opts: VerifyOrderOptions,
): Promise<void> {
  if (!opts.reference && !opts.orderId) {
    throw new Error('verifyOrderInBackOffice needs either a reference or an orderId');
  }

  if (opts.orderId) {
    const detail = await admin.goToOrder(opts.orderId);
    await expect
      .poll(() => detail.currentState(), {
        timeout: opts.timeoutMs ?? 30_000,
        message: `Order ${opts.orderId} never reached state '${opts.expectedState}'`,
      })
      .toContain(opts.expectedState);

    if (opts.expectedTotal) {
      expect(normaliseAmount(await detail.totalPaidText())).toBe(normaliseAmount(opts.expectedTotal));
    }
    return;
  }

  const reference = opts.reference as string;
  const orders = await admin.goToOrders();
  await orders.searchByReference(reference);
  await expect(
    orders.rowForReference(reference),
    `No back-office order row found for reference ${reference}`,
  ).toBeVisible();

  await expect
    .poll(
      async () => {
        await admin.page.reload();
        return orders.stateForReference(reference);
      },
      {
        timeout: opts.timeoutMs ?? 30_000,
        message: `Order ${reference} never reached state '${opts.expectedState}'`,
      },
    )
    .toContain(opts.expectedState);
}

/** Compare money by its digits so '€24.98' and '24,98 €' do not disagree spuriously. */
function normaliseAmount(value: string): string {
  return value.replace(/[^\d]/g, '');
}

export interface ConfigureModuleOptions {
  name: string;
}

/**
 * Open a module's configuration page in the back office and let the caller fill it
 * (spec §3.5). The kit owns getting there; the module's own fields are the consumer's
 * knowledge.
 */
export async function configureModule(
  admin: AdminPanel,
  name: string,
  configure: (page: ModuleConfigPage) => Promise<void>,
): Promise<void> {
  const page = await admin.goToModuleConfig(name);
  await expect(
    page.form,
    `Module '${name}' did not render a configuration form. Is it installed and configurable?`,
  ).toBeVisible();
  await configure(page);
}

export interface RefundOrderOptions {
  reference: string;
  /** Omit for a full refund. */
  partial?: { amount: string };
}

/**
 * Issue a refund from the back-office order page (spec §3.5).
 *
 * Routed through whichever refund control the module contributes, falling back to
 * PrestaShop's standard refund. Exercised for real in Phase 3, where a payment module
 * with a refund UI exists to drive it.
 */
export async function refundOrder(admin: AdminPanel, opts: RefundOrderOptions): Promise<void> {
  const orders = await admin.goToOrders();
  await orders.openOrder(opts.reference);

  const detail = admin.orderDetail;
  await expect(
    detail.refundButton,
    `No refund control on the back-office page for order ${opts.reference}`,
  ).toBeVisible();
  await detail.refundButton.click();

  if (opts.partial) {
    const amountField = admin.page.locator('input[name*="amount"]').first();
    await expect(amountField).toBeVisible();
    await amountField.fill(opts.partial.amount);
  }

  await admin.page.getByRole('button', { name: /refund/i }).last().click();
  await expect(admin.page.locator('.alert-success')).toBeVisible();
}
