#!/usr/bin/env node
/**
 * Mollie API mock server (spec §6.4).
 *
 * Two listeners over one shared store, because the mock plays two different roles:
 *
 *  - **:443 over TLS, as `api.mollie.com`.** This is what the module's SDK talks to. It gets
 *    there purely through compose: `docker-compose.mock.yml` gives this container the network
 *    alias `api.mollie.com`, and the leaf certificate is signed by the E2E CA. Zero module
 *    configuration, which is the hard requirement in §6.4 — the module under test is
 *    byte-identical to what ships to merchants.
 *  - **:8090 over plain HTTP.** The browser-facing stand-in checkout page and the test-control
 *    plane. Playwright reaches this directly on the published host port; it is deliberately not
 *    intercepted (§6.4 item 5).
 *
 * Both listeners serve every route. That is intentional: it makes the mock usable over plain
 * HTTP for the fast `testOrder` path and for debugging with curl, without a second code path
 * to keep honest.
 */

import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { MockStore, METHODS } from './store.mjs';
import {
  buildPayment,
  buildOrder,
  buildRefund,
  buildMethod,
  serialisePayment,
  serialiseOrder,
  sumAmounts,
  toCents,
  apiError,
} from './resources.mjs';
import { checkoutPage } from './checkout-page.mjs';

const HTTP_PORT = Number(process.env.MOCK_HTTP_PORT ?? 8090);
const HTTPS_PORT = Number(process.env.MOCK_HTTPS_PORT ?? 443);
const PUBLIC_URL = process.env.MOCK_PUBLIC_URL ?? `http://localhost:${HTTP_PORT}`;
const TLS_CERT = process.env.MOCK_TLS_CERT ?? '/etc/mollie-mock/tls/server.crt';
const TLS_KEY = process.env.MOCK_TLS_KEY ?? '/etc/mollie-mock/tls/server.key';

const store = new MockStore({ publicUrl: PUBLIC_URL });

/** `?embed=payments,refunds` → `['payments','refunds']`. */
function embedList(query) {
  const raw = query?.embed ?? query?.include;
  return typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function registerRoutes(app) {
  app.register(formbody);

  /**
   * Answer unknown routes in Mollie's error shape, and record them.
   *
   * Fastify's default 404 body carries an `error` key, and the module's adapter reads
   * `$body->error->message` whenever one is present (`CurlPSMollieHttpAdapter.php:222`). On a
   * Fastify 404 that resolves to null, so an unimplemented endpoint surfaces inside PrestaShop as
   * an ApiException with an *empty message* — which says nothing about what was actually called.
   * Answering in Mollie's shape keeps the module's error text useful, and the recorded path names
   * the endpoint that still needs implementing.
   */
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/v2/')) {
      store.recordRequest({
        at: Date.now(),
        ts: new Date().toISOString(),
        method: request.method,
        path: request.url.split('?')[0],
        url: request.url,
        query: request.query ?? {},
        body: request.body ?? null,
        unimplemented: true,
      });
      console.warn(`[mollie-mock] UNIMPLEMENTED ${request.method} ${request.url}`);
    }
    return reply
      .code(404)
      .send(apiError(404, 'Not Found', `No endpoint ${request.method} ${request.url} in the mock`));
  });

  /**
   * Every `/v2` request is logged before it is served, so `GET /__admin/requests` can prove the
   * module made the call a test expects (§6.3a). The admin plane and the stand-in page are not
   * module traffic and are deliberately excluded.
   */
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/v2/')) return;
    store.recordRequest({
      at: Date.now(),
      ts: new Date().toISOString(),
      method: request.method,
      path: request.url.split('?')[0],
      url: request.url,
      query: request.query ?? {},
      body: request.body ?? null,
      authorization: typeof request.headers.authorization === 'string' ? 'present' : 'absent',
    });
  });

  // --- Payments API ---------------------------------------------------------------

  app.post('/v2/payments', async (request, reply) => {
    const payment = buildPayment(store, request.body ?? {});
    store.payments.set(payment.id, payment);
    return reply.code(201).send(serialisePayment(store, payment));
  });

  app.get('/v2/payments/:id', async (request, reply) => {
    const payment = store.payments.get(request.params.id);
    if (!payment) {
      return reply.code(404).send(apiError(404, 'Not Found', `No payment ${request.params.id}`));
    }
    return serialisePayment(store, payment, { embed: embedList(request.query) });
  });

  /**
   * `$payment->update()`. The module calls this right after it creates the PrestaShop order, to
   * replace the placeholder description it sent at payment time with the shop's real order
   * reference (`TransactionService::updatePaymentDescription`).
   *
   * Not optional: in the refund path the module calls it *outside* a try/catch, so a missing
   * endpoint turns the webhook into a 400 and the refund never settles.
   */
  app.patch('/v2/payments/:id', async (request, reply) => {
    const payment = store.payments.get(request.params.id);
    if (!payment) {
      return reply.code(404).send(apiError(404, 'Not Found', `No payment ${request.params.id}`));
    }
    // Only the fields Mollie actually lets you update, so a module sending something else finds
    // out here rather than silently having it accepted.
    for (const field of ['description', 'redirectUrl', 'webhookUrl', 'metadata']) {
      if (request.body && field in request.body) payment[field] = request.body[field];
    }
    return serialisePayment(store, payment);
  });

  /** `$payment->cancel()` in `CancelService`. */
  app.delete('/v2/payments/:id', async (request, reply) => {
    const payment = store.payments.get(request.params.id);
    if (!payment) {
      return reply.code(404).send(apiError(404, 'Not Found', `No payment ${request.params.id}`));
    }
    if (!payment.isCancelable) {
      return reply
        .code(422)
        .send(apiError(422, 'Unprocessable Entity', 'The payment cannot be canceled'));
    }
    payment.status = 'canceled';
    payment.isCancelable = false;
    return serialisePayment(store, payment);
  });

  app.post('/v2/payments/:id/refunds', async (request, reply) => {
    const payment = store.payments.get(request.params.id);
    if (!payment) {
      return reply.code(404).send(apiError(404, 'Not Found', `No payment ${request.params.id}`));
    }
    if (payment.status !== 'paid') {
      return reply
        .code(422)
        .send(apiError(422, 'Unprocessable Entity', 'Only paid payments can be refunded'));
    }

    const already = store.refunds.get(payment.id) ?? [];
    const amount = request.body?.amount ?? {
      currency: payment.amount.currency,
      value: payment.amount.value,
    };

    const remaining = toCents(payment.amount.value) - toCents(sumAmounts(already.map((r) => r.amount.value)));
    if (toCents(amount.value) > remaining) {
      return reply
        .code(422)
        .send(
          apiError(
            422,
            'Unprocessable Entity',
            'The amount is higher than the remaining amount that can be refunded',
            'amount',
          ),
        );
    }

    const refund = buildRefund(store, payment, amount);
    store.refunds.set(payment.id, [...already, refund]);
    return reply.code(201).send(refund);
  });

  app.get('/v2/payments/:id/refunds', async (request) => {
    const refunds = store.refunds.get(request.params.id) ?? [];
    return { count: refunds.length, _embedded: { refunds }, _links: {} };
  });

  /** Manual-capture methods; `CaptureService` reads `$payment->captures()`. */
  app.post('/v2/payments/:id/captures', async (request, reply) => {
    const payment = store.payments.get(request.params.id);
    if (!payment) {
      return reply.code(404).send(apiError(404, 'Not Found', `No payment ${request.params.id}`));
    }
    const amount = request.body?.amount ?? payment.amount;
    const capture = {
      resource: 'capture',
      id: store.nextId('cpt'),
      mode: 'test',
      amount,
      paymentId: payment.id,
      status: 'succeeded',
      createdAt: store.timestamp(),
    };
    store.captures.set(payment.id, [...(store.captures.get(payment.id) ?? []), capture]);
    return reply.code(201).send(capture);
  });

  app.get('/v2/payments/:id/captures', async (request) => {
    const captures = store.captures.get(request.params.id) ?? [];
    return { count: captures.length, _embedded: { captures }, _links: {} };
  });

  // --- Orders API ----------------------------------------------------------------

  app.post('/v2/orders', async (request, reply) => {
    const order = buildOrder(store, request.body ?? {});
    store.orders.set(order.id, order);
    return reply.code(201).send(serialiseOrder(store, order));
  });

  app.get('/v2/orders/:id', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send(apiError(404, 'Not Found', `No order ${request.params.id}`));
    }
    return serialiseOrder(store, order, { embed: embedList(request.query) });
  });

  /** The Orders API equivalent of the description update above. */
  app.patch('/v2/orders/:id', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send(apiError(404, 'Not Found', `No order ${request.params.id}`));
    }
    for (const field of ['orderNumber', 'redirectUrl', 'webhookUrl', 'metadata']) {
      if (request.body && field in request.body) order[field] = request.body[field];
    }
    return serialiseOrder(store, order);
  });

  app.delete('/v2/orders/:id', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send(apiError(404, 'Not Found', `No order ${request.params.id}`));
    }
    order.status = 'canceled';
    order.isCancelable = false;
    for (const embedded of order._embedded.payments) {
      const payment = store.payments.get(embedded.id);
      if (payment) {
        payment.status = 'canceled';
        payment.isCancelable = false;
      }
    }
    return serialiseOrder(store, order);
  });

  app.post('/v2/orders/:id/refunds', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send(apiError(404, 'Not Found', `No order ${request.params.id}`));
    }

    const lines = request.body?.lines ?? null;
    // `refundAll()` sends an empty `lines` array, meaning "everything".
    const isFullRefund = !lines || lines.length === 0;
    const amount = isFullRefund
      ? { currency: order.amount.currency, value: order.amount.value }
      : (request.body.amount ?? amountForLines(order, lines));

    const refund = buildRefund(store, order, amount, { lines });
    store.refunds.set(order.id, [...(store.refunds.get(order.id) ?? []), refund]);

    // The order's payment is what the webhook inspects, so mirror the refund onto it.
    const paymentId = order._embedded.payments[0].id;
    store.refunds.set(paymentId, [...(store.refunds.get(paymentId) ?? []), refund]);

    return reply.code(201).send(refund);
  });

  /** `ShipService` → `$order->createShipment()`; `CaptureService` → `$order->shipAll()`. */
  app.post('/v2/orders/:id/shipments', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    if (!order) {
      return reply.code(404).send(apiError(404, 'Not Found', `No order ${request.params.id}`));
    }
    const shipment = {
      resource: 'shipment',
      id: store.nextId('shp'),
      orderId: order.id,
      createdAt: store.timestamp(),
      lines: request.body?.lines ?? order.lines,
      tracking: request.body?.tracking ?? null,
    };
    store.shipments.set(order.id, [...(store.shipments.get(order.id) ?? []), shipment]);
    order.status = 'shipping';
    return reply.code(201).send(shipment);
  });

  // --- Methods -------------------------------------------------------------------

  // `allAvailable()` → /v2/methods/all, which is what the BO config screen uses.
  // `allActive()` → /v2/methods. The mock advertises the same set for both.
  const methodsHandler = async () => {
    const methods = METHODS.map((m) => buildMethod(store, m));
    return { count: methods.length, _embedded: { methods }, _links: {} };
  };
  app.get('/v2/methods', methodsHandler);
  app.get('/v2/methods/all', methodsHandler);

  app.get('/v2/methods/:id', async (request, reply) => {
    const method = METHODS.find((m) => m.id === request.params.id);
    if (!method) {
      return reply.code(404).send(apiError(404, 'Not Found', `No method ${request.params.id}`));
    }
    return buildMethod(store, method);
  });

  /** The module's "test API key" button and profile-id provider hit these. */
  app.get('/v2/profiles/me', async () => ({
    resource: 'profile',
    id: 'pfl_e2emock',
    mode: 'test',
    name: 'Invertus E2E mock profile',
    website: PUBLIC_URL,
    status: 'verified',
    _links: {},
  }));

  app.get('/v2/permissions', async () => ({
    count: 0,
    _embedded: { permissions: [] },
    _links: {},
  }));

  // --- Browser-facing stand-in hosted checkout (§6.4) -----------------------------

  app.get('/checkout/:id', async (request, reply) => {
    const resource = store.orders.get(request.params.id) ?? store.payments.get(request.params.id);
    if (!resource) return reply.code(404).type('text/html').send('<h1>Unknown payment</h1>');
    return reply.type('text/html').send(checkoutPage(resource));
  });

  app.post('/checkout/:id', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    const payment = order
      ? store.payments.get(order._embedded.payments[0].id)
      : store.payments.get(request.params.id);
    if (!payment) return reply.code(404).type('text/html').send('<h1>Unknown payment</h1>');

    const status = String(request.body?.status ?? 'paid');
    applyStatus(order, payment, status);

    const target = payment.redirectUrl ?? order?.redirectUrl;
    if (!target) {
      return reply
        .type('text/html')
        .send('<h1>No redirectUrl was supplied when the payment was created</h1>');
    }
    return reply.redirect(target, 302);
  });

  // --- Test-control plane (never reachable outside the compose network) ------------

  app.get('/__admin/health', async () => ({ ok: true, payments: store.payments.size }));

  app.get('/__admin/payments', async (request, reply) => {
    const { ref, id } = request.query ?? {};
    if (id) {
      const found = store.payments.get(id) ?? store.orders.get(id);
      if (!found) return reply.code(404).send({ error: `No resource ${id}` });
      return describe(found);
    }
    if (ref) {
      const found = store.findByOrderReference(ref);
      if (!found) return reply.code(404).send({ error: `No resource for reference ${ref}` });
      return describe(found);
    }
    return {
      payments: [...store.payments.values()].map(describe),
      orders: [...store.orders.values()].map(describe),
    };
  });

  app.put('/__admin/payments/:id/status', async (request, reply) => {
    const order = store.orders.get(request.params.id);
    const payment = order
      ? store.payments.get(order._embedded.payments[0].id)
      : store.payments.get(request.params.id);
    if (!payment) return reply.code(404).send({ error: `No resource ${request.params.id}` });

    const status = String(request.body?.status ?? '');
    if (!status) return reply.code(400).send({ error: 'body.status is required' });

    applyStatus(order, payment, status);
    return describe(order ?? payment);
  });

  app.get('/__admin/requests', async (request) => {
    const { since, path, method } = request.query ?? {};
    const matches = store.queryRequests({ since, pathGlob: path, method });
    return { count: matches.length, requests: matches };
  });

  app.delete('/__admin/requests', async () => {
    const cleared = store.requests.length;
    store.requests = [];
    return { cleared };
  });

  /** Everything, for debugging a failed spec from a trace. */
  app.get('/__admin/state', async () => ({
    counter: store.counter,
    payments: [...store.payments.values()],
    orders: [...store.orders.values()],
    refunds: Object.fromEntries(store.refunds),
    requests: store.requests.length,
  }));
}

/**
 * The projection tests work against: enough to drive a webhook and assert an outcome, without
 * leaking the full HAL envelope into spec code.
 */
function describe(resource) {
  const isOrder = resource.resource === 'order';
  const payment = isOrder ? resource._embedded.payments[0] : resource;
  const refunds = store.refunds.get(resource.id) ?? [];

  return {
    /** The id the module knows this transaction by — an `ord_` id for Orders API flows. */
    id: resource.id,
    resource: resource.resource,
    paymentId: payment.id,
    status: payment.status,
    orderStatus: isOrder ? resource.status : null,
    amount: resource.amount,
    amountRefunded: { currency: resource.amount.currency, value: sumAmounts(refunds.map((r) => r.amount.value)) },
    method: resource.method,
    orderReference: resource.metadata?.order_reference ?? null,
    cartId: resource.metadata?.cart_id ?? null,
    /** The exact URL the module asked Mollie to call — what `ensureWebhookProcessed` POSTs to. */
    webhookUrl: resource.webhookUrl ?? payment.webhookUrl ?? null,
    redirectUrl: resource.redirectUrl ?? payment.redirectUrl ?? null,
    checkoutUrl: resource._links?.checkout?.href ?? null,
    refunds: refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status })),
  };
}

/**
 * Move a payment (and its order, if any) to `status`.
 *
 * Order status is not simply the payment status: Mollie's order resource has its own
 * vocabulary, and `return.php` reads the *payment's* status out of `_embedded.payments`, so the
 * two must stay consistent in the way the real API keeps them consistent.
 */
function applyStatus(order, payment, status) {
  payment.status = status;
  payment.isCancelable = status === 'open' || status === 'pending';
  if (status === 'paid') payment.paidAt = store.timestamp();

  if (!order) return;
  const ORDER_STATUS = {
    open: 'created',
    pending: 'pending',
    authorized: 'authorized',
    paid: 'paid',
    canceled: 'canceled',
    expired: 'expired',
    failed: 'canceled',
  };
  order.status = ORDER_STATUS[status] ?? order.status;
  order.isCancelable = order.status === 'created' || order.status === 'pending';
}

function amountForLines(order, lines) {
  const cents = lines.reduce((acc, line) => {
    const match = order.lines.find((l) => l.id === line.id);
    if (!match) return acc;
    const unit = toCents(match.totalAmount?.value ?? match.unitPrice?.value ?? '0.00');
    const quantity = line.quantity ?? match.quantity ?? 1;
    return acc + (match.totalAmount ? unit : unit * quantity);
  }, 0);
  return { currency: order.amount.currency, value: (cents / 100).toFixed(2) };
}

async function main() {
  const logLevel = process.env.MOCK_LOG_LEVEL ?? 'warn';

  const http = Fastify({ logger: { level: logLevel } });
  registerRoutes(http);
  await http.listen({ host: '0.0.0.0', port: HTTP_PORT });
  console.log(`[mollie-mock] http  listening on :${HTTP_PORT} (public url ${PUBLIC_URL})`);

  // TLS is what makes the DNS alias useful; without it the SDK's https:// call cannot land.
  // Failing to start it is fatal rather than degraded: a mock reachable only over HTTP would
  // let a run go green while testing nothing.
  const https = Fastify({
    logger: { level: logLevel },
    https: { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) },
  });
  registerRoutes(https);
  await https.listen({ host: '0.0.0.0', port: HTTPS_PORT });
  console.log(`[mollie-mock] https listening on :${HTTPS_PORT} as api.mollie.com`);
}

main().catch((err) => {
  console.error('[mollie-mock] failed to start:', err);
  process.exit(1);
});
