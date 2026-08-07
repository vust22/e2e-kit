/**
 * Mollie-shaped response builders (spec §6.4).
 *
 * Shapes are dictated by what `mollie/mollie-api-php` v2.65 deserialises and what the module
 * then reads off the result. The load-bearing details, all verified against module source and
 * recorded in `pilots/mollie/e2e/NOTES.md`:
 *
 * - `mode: 'test'` — `controllers/front/return.php:341` branches on it for open/pending.
 * - `metadata` echoed back verbatim — `TransactionService` re-derives and compares
 *   `metadata.secure_key`, so a lossy round-trip fails every checkout with
 *   "Security key is incorrect".
 * - `_links.refunds` present ONLY when refunds exist — the SDK's `Payment::hasRefunds()` is
 *   an `isset` on that link, and `TransactionService:200` uses it to decide whether a webhook
 *   means "refunded" instead of "paid".
 * - order ids carry the `ord_` prefix — `TransactionUtility::isOrderTransaction` is a literal
 *   three-character prefix test that routes the whole webhook and refund flow.
 */

const DOCS = { href: 'https://docs.mollie.com/reference', type: 'text/html' };

function selfLink(base, collection, id) {
  return { href: `${base}/v2/${collection}/${id}`, type: 'application/hal+json' };
}

export function buildPayment(store, body, { orderId = null } = {}) {
  const id = store.nextId('tr');
  const createdAt = store.timestamp();

  return {
    resource: 'payment',
    id,
    mode: 'test',
    createdAt,
    amount: body.amount ?? { currency: 'EUR', value: '0.00' },
    description: body.description ?? id,
    method: body.method ?? null,
    metadata: body.metadata ?? null,
    status: 'open',
    isCancelable: true,
    expiresAt: createdAt,
    profileId: 'pfl_e2emock',
    sequenceType: body.sequenceType ?? 'oneoff',
    redirectUrl: body.redirectUrl ?? null,
    webhookUrl: body.webhookUrl ?? null,
    locale: body.locale ?? 'en_US',
    orderId,
    amountRefunded: { currency: (body.amount ?? {}).currency ?? 'EUR', value: '0.00' },
    amountRemaining: body.amount ?? { currency: 'EUR', value: '0.00' },
    /** Set by the capture flow when the module asks for manual capture. */
    captureMode: body.captureMode ?? null,
    _links: {
      self: selfLink('https://api.mollie.com', 'payments', id),
      checkout: { href: `${store.publicUrl}/checkout/${id}`, type: 'text/html' },
      documentation: DOCS,
    },
  };
}

export function buildOrder(store, body) {
  const id = store.nextId('ord');
  const createdAt = store.timestamp();

  // A Mollie order always owns at least one payment; the module reaches it through
  // `_embedded.payments` in `return.php` and in the webhook.
  const payment = buildPayment(
    store,
    {
      amount: body.amount,
      description: body.orderNumber ?? id,
      method: body.method ?? null,
      metadata: body.metadata ?? null,
      redirectUrl: body.redirectUrl ?? null,
      webhookUrl: body.payment?.webhookUrl ?? body.webhookUrl ?? null,
    },
    { orderId: id },
  );
  store.payments.set(payment.id, payment);

  return {
    resource: 'order',
    id,
    mode: 'test',
    createdAt,
    profileId: 'pfl_e2emock',
    status: 'created',
    isCancelable: true,
    amount: body.amount ?? { currency: 'EUR', value: '0.00' },
    amountCaptured: { currency: (body.amount ?? {}).currency ?? 'EUR', value: '0.00' },
    amountRefunded: { currency: (body.amount ?? {}).currency ?? 'EUR', value: '0.00' },
    orderNumber: body.orderNumber ?? id,
    metadata: body.metadata ?? null,
    redirectUrl: body.redirectUrl ?? null,
    webhookUrl: body.payment?.webhookUrl ?? body.webhookUrl ?? null,
    locale: body.locale ?? 'en_US',
    method: body.method ?? null,
    lines: (body.lines ?? []).map((line, index) => ({
      resource: 'orderline',
      id: `odl_e2e${String(index + 1).padStart(4, '0')}`,
      orderId: id,
      ...line,
    })),
    _embedded: { payments: [payment] },
    _links: {
      self: selfLink('https://api.mollie.com', 'orders', id),
      checkout: { href: `${store.publicUrl}/checkout/${id}`, type: 'text/html' },
      documentation: DOCS,
    },
  };
}

export function buildRefund(store, parent, amount, { lines = null } = {}) {
  const id = store.nextId('re');
  const isOrder = parent.resource === 'order';

  return {
    resource: 'refund',
    id,
    amount,
    status: 'refunded',
    createdAt: store.timestamp(),
    description: `E2E refund ${id}`,
    metadata: null,
    paymentId: isOrder ? parent._embedded.payments[0].id : parent.id,
    orderId: isOrder ? parent.id : (parent.orderId ?? null),
    lines,
    _links: {
      self: { href: `https://api.mollie.com/v2/refunds/${id}`, type: 'application/hal+json' },
      documentation: DOCS,
    },
  };
}

export function buildMethod(store, { id, description }) {
  return {
    resource: 'method',
    id,
    description,
    // `ApiService::getMethodsForConfig` drops anything not exactly 'activated'.
    status: 'activated',
    minimumAmount: { value: '0.01', currency: 'EUR' },
    maximumAmount: { value: '10000.00', currency: 'EUR' },
    image: {
      size1x: `${store.publicUrl}/static/${id}.png`,
      size2x: `${store.publicUrl}/static/${id}-2x.png`,
      svg: `${store.publicUrl}/static/${id}.svg`,
    },
    _links: {
      self: selfLink('https://api.mollie.com', 'methods', id),
      documentation: DOCS,
    },
  };
}

/**
 * Attach the derived, refund-dependent fields to a payment before serving it. Kept out of the
 * stored object so the stored object stays the pure record of what the module sent.
 */
export function serialisePayment(store, payment, { embed = [] } = {}) {
  const refunds = store.refunds.get(payment.id) ?? [];
  const captures = store.captures.get(payment.id) ?? [];
  const out = { ...payment, _links: { ...payment._links }, _embedded: undefined };

  out.amountRefunded = {
    currency: payment.amount.currency,
    value: sumAmounts(refunds.map((r) => r.amount.value)),
  };
  out.amountRemaining = {
    currency: payment.amount.currency,
    value: subtractAmounts(payment.amount.value, out.amountRefunded.value),
  };

  if (refunds.length > 0) {
    out._links.refunds = {
      href: `https://api.mollie.com/v2/payments/${payment.id}/refunds`,
      type: 'application/hal+json',
    };
  }
  if (captures.length > 0) {
    out._links.captures = {
      href: `https://api.mollie.com/v2/payments/${payment.id}/captures`,
      type: 'application/hal+json',
    };
  }

  const embedded = {};
  if (embed.includes('refunds')) embedded.refunds = refunds;
  if (embed.includes('captures')) embedded.captures = captures;
  if (Object.keys(embedded).length > 0) out._embedded = embedded;
  else delete out._embedded;

  return out;
}

export function serialiseOrder(store, order, { embed = [] } = {}) {
  const payments = order._embedded.payments.map((p) =>
    serialisePayment(store, store.payments.get(p.id) ?? p),
  );
  const refunds = store.refunds.get(order.id) ?? [];
  const out = { ...order, _links: { ...order._links } };

  out.amountRefunded = {
    currency: order.amount.currency,
    value: sumAmounts(refunds.map((r) => r.amount.value)),
  };

  // `return.php` and the webhook both request `embed=payments`, and both read
  // `_embedded->payments`, so payments are always embedded regardless of the query.
  const embedded = { payments };
  if (embed.includes('refunds')) embedded.refunds = refunds;
  if (embed.includes('shipments')) embedded.shipments = store.shipments.get(order.id) ?? [];
  out._embedded = embedded;

  if (refunds.length > 0) {
    out._links.refunds = {
      href: `https://api.mollie.com/v2/orders/${order.id}/refunds`,
      type: 'application/hal+json',
    };
  }

  return out;
}

/**
 * Mollie amounts are decimal strings with exactly two places, and the module compares them
 * as strings in places (`NumberUtility::isLowerOrEqualThan`). Doing the arithmetic in integer
 * cents keeps "0.1 + 0.2" out of the assertions.
 */
export function sumAmounts(values) {
  const cents = values.reduce((acc, v) => acc + toCents(v), 0);
  return fromCents(cents);
}

export function subtractAmounts(a, b) {
  return fromCents(toCents(a) - toCents(b));
}

export function toCents(value) {
  return Math.round(Number.parseFloat(String(value)) * 100);
}

export function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

/** Mollie's error envelope, which the module's adapter parses in `parseResponseBody`. */
export function apiError(status, title, detail, field = null) {
  const body = { status, title, detail, _links: { documentation: DOCS } };
  if (field) body.field = field;
  return body;
}
