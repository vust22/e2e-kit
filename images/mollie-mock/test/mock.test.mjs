/**
 * Unit tests for the mock's contract with the module.
 *
 * These assert the details that, if wrong, fail as something else entirely inside PrestaShop —
 * "Security key is incorrect", a webhook that turns a paid order into a refunded one, or a
 * checkout that silently offers no Mollie methods. Each is traced to the module source line
 * that depends on it in `pilots/mollie/e2e/NOTES.md`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockStore, globToRegExp, METHODS } from '../src/store.mjs';
import {
  buildPayment,
  buildOrder,
  buildRefund,
  buildMethod,
  serialisePayment,
  serialiseOrder,
  sumAmounts,
  subtractAmounts,
} from '../src/resources.mjs';

const newStore = () => new MockStore({ publicUrl: 'http://localhost:8090' });

const paymentBody = {
  amount: { currency: 'EUR', value: '24.90' },
  description: 'ps_order_ref',
  method: 'ideal',
  redirectUrl: 'http://localhost:8080/return',
  webhookUrl: 'http://localhost:8080/webhook?security_token=abc',
  metadata: { cart_id: 7, order_reference: 'ABCDEFGHI', secure_key: 'deadbeef' },
};

test('payment ids are deterministic and counter-based', () => {
  const store = newStore();
  const first = buildPayment(store, paymentBody);
  const second = buildPayment(store, paymentBody);
  assert.equal(first.id, 'tr_e2e0001');
  assert.equal(second.id, 'tr_e2e0002');
});

test('order ids carry the ord_ prefix TransactionUtility::isOrderTransaction tests for', () => {
  const store = newStore();
  const order = buildOrder(store, { ...paymentBody, orderNumber: 'ABCDEFGHI' });
  assert.equal(order.id.slice(0, 3), 'ord');
});

test('payments report mode test, which return.php branches on for open/pending', () => {
  const store = newStore();
  assert.equal(buildPayment(store, paymentBody).mode, 'test');
  assert.equal(buildOrder(store, paymentBody).mode, 'test');
});

test('metadata round-trips verbatim so the secure_key comparison passes', () => {
  const store = newStore();
  const payment = buildPayment(store, paymentBody);
  store.payments.set(payment.id, payment);
  const served = serialisePayment(store, payment);
  assert.deepEqual(served.metadata, paymentBody.metadata);
});

test('checkout link points at the browser-reachable public url, not api.mollie.com', () => {
  const store = newStore();
  const payment = buildPayment(store, paymentBody);
  assert.equal(payment._links.checkout.href, 'http://localhost:8090/checkout/tr_e2e0001');
});

test('_links.refunds is absent until a refund exists (Payment::hasRefunds is an isset)', () => {
  const store = newStore();
  const payment = buildPayment(store, paymentBody);
  store.payments.set(payment.id, payment);

  assert.equal(serialisePayment(store, payment)._links.refunds, undefined);

  const refund = buildRefund(store, payment, { currency: 'EUR', value: '24.90' });
  store.refunds.set(payment.id, [refund]);

  const served = serialisePayment(store, payment);
  assert.ok(served._links.refunds, 'refunds link must appear once a refund exists');
  assert.equal(served.amountRefunded.value, '24.90');
});

test('partial refunds accumulate in cents, not floats', () => {
  const store = newStore();
  const payment = buildPayment(store, paymentBody);
  store.payments.set(payment.id, payment);
  store.refunds.set(payment.id, [
    buildRefund(store, payment, { currency: 'EUR', value: '0.10' }),
    buildRefund(store, payment, { currency: 'EUR', value: '0.20' }),
  ]);

  const served = serialisePayment(store, payment);
  assert.equal(served.amountRefunded.value, '0.30');
  assert.equal(served.amountRemaining.value, '24.60');
});

test('amount helpers stay exact across the values a shop actually produces', () => {
  assert.equal(sumAmounts(['0.10', '0.20']), '0.30');
  assert.equal(sumAmounts([]), '0.00');
  assert.equal(subtractAmounts('24.90', '1.51'), '23.39');
  assert.equal(sumAmounts(['1.005', '1.005']), '2.00');
});

test('an order always embeds a payment, which is what the webhook reads', () => {
  const store = newStore();
  const order = buildOrder(store, paymentBody);
  store.orders.set(order.id, order);

  const served = serialiseOrder(store, order, { embed: ['payments'] });
  assert.equal(served._embedded.payments.length, 1);
  assert.equal(served._embedded.payments[0].resource, 'payment');
  assert.deepEqual(served._embedded.payments[0].metadata, paymentBody.metadata);
});

test('an order refund is mirrored onto the embedded payment', () => {
  const store = newStore();
  const order = buildOrder(store, paymentBody);
  store.orders.set(order.id, order);
  const paymentId = order._embedded.payments[0].id;

  const refund = buildRefund(store, order, { currency: 'EUR', value: '24.90' });
  store.refunds.set(order.id, [refund]);
  store.refunds.set(paymentId, [refund]);

  const served = serialiseOrder(store, order, { embed: ['refunds'] });
  assert.equal(served.amountRefunded.value, '24.90');
  assert.ok(served._embedded.payments[0]._links.refunds);
});

test('every advertised method is activated, or getMethodsForConfig drops it', () => {
  const store = newStore();
  for (const method of METHODS) {
    assert.equal(buildMethod(store, method).status, 'activated');
  }
});

test('the advertised set covers the methods the pilot puts under test', () => {
  const ids = METHODS.map((m) => m.id);
  for (const required of ['ideal', 'creditcard', 'banktransfer']) {
    assert.ok(ids.includes(required), `mock must advertise ${required}`);
  }
});

test('payments are findable by the order_reference the module put in metadata', () => {
  const store = newStore();
  const payment = buildPayment(store, paymentBody);
  store.payments.set(payment.id, payment);

  assert.equal(store.findByOrderReference('ABCDEFGHI')?.id, payment.id);
  assert.equal(store.findByOrderReference('NOPE'), null);
});

test('an Orders API transaction is findable by reference too', () => {
  const store = newStore();
  const order = buildOrder(store, paymentBody);
  store.orders.set(order.id, order);

  const found = store.findByOrderReference('ABCDEFGHI');
  assert.equal(found?.resource, 'order', 'the order, not its embedded payment, must win');
});

test('request log filters by path glob, method and since', () => {
  const store = newStore();
  store.recordRequest({ at: 1000, method: 'POST', path: '/v2/payments' });
  store.recordRequest({ at: 2000, method: 'GET', path: '/v2/payments/tr_e2e0001' });
  store.recordRequest({ at: 3000, method: 'POST', path: '/v2/payments/tr_e2e0001/refunds' });

  assert.equal(store.queryRequests({ pathGlob: '/v2/payments/*/refunds' }).length, 1);
  assert.equal(store.queryRequests({ method: 'post' }).length, 2);
  assert.equal(store.queryRequests({ since: 2000 }).length, 2);
  assert.equal(
    store.queryRequests({ since: 2500, method: 'POST', pathGlob: '/v2/payments/*' }).length,
    1,
  );
});

test('glob translation does not let a dot match anything', () => {
  assert.ok(globToRegExp('/v2/payments/*').test('/v2/payments/tr_1'));
  assert.ok(!globToRegExp('/v2/payments').test('/v2/paymentsX'));
  assert.ok(!globToRegExp('/v2/a.b').test('/v2/axb'));
});
