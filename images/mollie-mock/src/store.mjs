/**
 * In-memory state for the Mollie API mock (spec §6.4).
 *
 * Determinism rules from the spec: no randomness except id suffixes, ids carry an
 * incrementing counter, and all state is in-memory so a container restart is a clean slate.
 * Compose teardown guarantees that between runs.
 */

/** Statuses the mock understands, mirroring Mollie's `PaymentStatus` / `OrderStatus`. */
export const PAYMENT_STATUSES = [
  'open',
  'pending',
  'authorized',
  'paid',
  'canceled',
  'expired',
  'failed',
];

/**
 * Payment methods the mock advertises. `description` is what the module shows as the method
 * name at checkout, so these strings are what storefront locators match on.
 */
export const METHODS = [
  { id: 'ideal', description: 'iDEAL' },
  { id: 'creditcard', description: 'Card' },
  { id: 'banktransfer', description: 'Bank transfer' },
  { id: 'bancontact', description: 'Bancontact' },
  { id: 'paypal', description: 'PayPal' },
];

export class MockStore {
  constructor({ publicUrl }) {
    this.publicUrl = publicUrl;
    /** @type {Map<string, object>} */
    this.payments = new Map();
    /** @type {Map<string, object>} */
    this.orders = new Map();
    /** @type {Map<string, object[]>} */
    this.refunds = new Map();
    /** @type {Map<string, object[]>} */
    this.captures = new Map();
    /** @type {Map<string, object[]>} */
    this.shipments = new Map();
    /** @type {object[]} */
    this.requests = [];
    this.counter = 0;
  }

  /**
   * Ids are `<prefix>_e2e<counter padded to 4>`, e.g. `tr_e2e0001`. The module only ever
   * treats these as opaque strings, except for the `ord` prefix test in
   * `TransactionUtility::isOrderTransaction` — which is exactly why order ids must use it.
   */
  nextId(prefix) {
    this.counter += 1;
    return `${prefix}_e2e${String(this.counter).padStart(4, '0')}`;
  }

  /**
   * A fixed clock offset from a fixed epoch: timestamps stay ordered and readable without
   * making two runs of the same suite produce different bytes.
   */
  timestamp() {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)).toISOString();
  }

  recordRequest(entry) {
    this.requests.push(entry);
  }

  /** `since` is an ISO timestamp or a millisecond epoch; `pathGlob` supports `*`. */
  queryRequests({ since, pathGlob, method } = {}) {
    let out = this.requests;
    if (since) {
      const cutoff = /^\d+$/.test(String(since))
        ? Number(since)
        : Date.parse(String(since));
      out = out.filter((r) => r.at >= cutoff);
    }
    if (method) {
      const wanted = String(method).toUpperCase();
      out = out.filter((r) => r.method === wanted);
    }
    if (pathGlob) {
      const rx = globToRegExp(pathGlob);
      out = out.filter((r) => rx.test(r.path));
    }
    return out;
  }

  findPaymentByOrderReference(reference) {
    for (const payment of this.payments.values()) {
      if (payment.metadata?.order_reference === reference) return payment;
    }
    return null;
  }

  findOrderByOrderReference(reference) {
    for (const order of this.orders.values()) {
      if (order.metadata?.order_reference === reference) return order;
    }
    return null;
  }

  /** Either resource, by the `order_reference` the module put in metadata. */
  findByOrderReference(reference) {
    return (
      this.findOrderByOrderReference(reference) ?? this.findPaymentByOrderReference(reference)
    );
  }
}

/** `*` matches any run of characters; everything else is literal. */
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
