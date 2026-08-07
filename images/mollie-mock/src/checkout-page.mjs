/**
 * The stand-in hosted checkout page (spec §6.4, `GET /checkout/:id`).
 *
 * Mollie's real test-mode screen is a status picker: radios for the final status plus a submit
 * button. The module's own Cypress suite pins that contract down to
 * `[value="paid"]` + `.button.form__button` (`cypress/support/commands.js`), so this page keeps
 * those exact hooks — a spec written against the mock stays valid against the real screen.
 *
 * On top of that it exposes proper roles and labels, so `MolliePsp.completeHostedCheckout` can
 * use a role-based locator (§7.1 preference order) instead of a value selector, and the same
 * locator works in sandbox mode.
 */

const STATUSES = [
  { value: 'paid', label: 'Paid' },
  { value: 'open', label: 'Open' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'expired', label: 'Expired' },
  { value: 'authorized', label: 'Authorized' },
  { value: 'pending', label: 'Pending' },
];

export function checkoutPage(resource) {
  const amount = resource.amount ?? { currency: 'EUR', value: '0.00' };
  const rows = STATUSES.map(
    ({ value, label }) => `
        <label class="status-option" for="status-${value}">
          <input type="radio" id="status-${value}" name="status" value="${value}"${
            value === 'paid' ? ' checked' : ''
          } />
          <span>${label}</span>
        </label>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mollie mock checkout — ${escapeHtml(resource.id)}</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 2.5rem 1.5rem; color: #1a1a1a; background: #f5f6f8; }
    main { max-width: 30rem; margin: 0 auto; background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 1px 3px rgb(0 0 0 / 12%); }
    h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
    .meta { color: #666; font-size: 0.875rem; margin: 0 0 1.5rem; }
    fieldset { border: 0; padding: 0; margin: 0 0 1.5rem; }
    legend { font-weight: 600; padding: 0 0 0.5rem; }
    .status-option { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.25rem; cursor: pointer; }
    .button { font: inherit; padding: 0.7rem 1.4rem; border: 0; border-radius: 8px; background: #0a6ed1; color: #fff; cursor: pointer; }
    .button:hover { background: #0857a6; }
    code { background: #f0f1f3; padding: 0.1rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>Select a payment status</h1>
    <p class="meta">
      Mollie E2E mock — <code>${escapeHtml(resource.id)}</code>
      · ${escapeHtml(amount.currency)}&nbsp;${escapeHtml(amount.value)}
      ${resource.method ? `· ${escapeHtml(resource.method)}` : ''}
    </p>
    <form method="post" action="/checkout/${encodeURIComponent(resource.id)}">
      <fieldset>
        <legend>Payment status</legend>${rows}
      </fieldset>
      <button type="submit" class="button form__button">Continue</button>
    </form>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}
