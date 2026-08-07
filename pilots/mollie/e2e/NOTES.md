# Mollie pilot — verified module facts

Resolves the agent note in spec §6.1: every claim below was read out of the module source,
not assumed. Nothing here is a guess; where the spec guessed differently, the difference is
called out and carried into `DECISIONS.md`.

- **Module:** `mollie/PrestaShop`, tag/commit `503b96c` (release 6.4.4), cloned read-only to
  `/Users/justas/e2e-playbook/mollie-module`.
- **Module directory name:** `mollie`. Class `Mollie`.
- **Dependency of note:** `mollie/mollie-api-php v2.65.0`, but the module supplies its **own**
  HTTP adapter (see TLS below) — the SDK's transport is never used.

---

## 1. Controllers and endpoints

| Purpose | Route | Source |
|---|---|---|
| Webhook | `index.php?fc=module&module=mollie&controller=webhook` | `controllers/front/webhook.php` |
| Browser return | `...&controller=return` | `controllers/front/return.php` |
| Payment initiation | `...&controller=payment` | `controllers/front/payment.php` |
| BO ajax (refund, ship, capture, cancel) | `AdminMollieAjax` controller, `action=refund` / `refundAll` | `controllers/admin/AdminMollieAjaxController.php:64` |

**The webhook requires a `security_token` parameter.** `webhook.php:71` rejects a request with
no `security_token` as `400 Missing security token`. The check is **presence-only** — the value
is never validated against anything, it is only used as the lock key (`webhook.php:91-95`).
The module generates it as `HashUtility::hash($cart->secure_key)`
(`src/Service/PaymentMethodService.php:333`).

Spec §6.2's sketch (`body: id=<paymentId>` alone) therefore returns 400. We do not need to
recompute the hash: the module sends the **full webhook URL** — token already in the query
string — to Mollie when creating the payment. The mock stores that `webhookUrl` and
`ensureWebhookProcessed` POSTs `id=<paymentId>` to exactly the URL the module asked for. That
is both higher fidelity than reconstructing the URL and provider-agnostic.

`webhook.php:62` also bails with `401 Unauthorized` if `getApiClient()` returns null, i.e. if
the API key is missing or malformed — see §2.

## 2. Configuration keys

Setup needs exactly two `Configuration` values (`src/Utility/EnvironmentUtility.php` reads them
straight out of `Configuration`, no `.env` involvement):

| Key | Value | Why |
|---|---|---|
| `MOLLIE_ENVIRONMENT` | `0` (`Config::ENVIRONMENT_TEST`) | selects the test API key slot |
| `MOLLIE_API_KEY_TEST` | must match `/^test_\w{30,}$/` | `ApiKeyService::validateApiKey` |

**The spec's placeholder key is too short.** `test_mockmockmockmockmockmockmock` has 28
characters after the prefix; the regex demands ≥30, so `setApiKey` throws `MollieException`,
`getApiClient()` returns null, and every checkout silently offers no Mollie methods. We use
`test_e2emockmockmockmockmockmockmockmock` (36 chars after the prefix).

## 3. Payments API vs Orders API

Both are live code paths, chosen **per payment method**, not globally:

```php
// src/Service/PaymentMethodService.php:483
if (Config::MOLLIE_ORDERS_API !== $molPaymentMethod->method) { /* → POST /v2/payments */ }
else                                                          { /* → POST /v2/orders   */ }
```

`$molPaymentMethod->method` is the `method` column of `mol_payment_method`, set from the
`MOLLIE_METHOD_API_<id>` form field. `Config::ORDER_API_ONLY_METHODS` is `[]` (Config.php:362),
so nothing is forced onto the Orders API. **The mock must implement both**, and the matrix
should cover both — a payments-API-only mock would leave half the module untested.

Both payloads carry `metadata: { cart_id, order_reference, secure_key }`, and
`TransactionService` re-derives and **compares** `secure_key` (`TransactionService:190`,
`:240`), so the mock must echo stored metadata back verbatim on `GET`.

## 4. Payment methods are database rows, not config

Checkout options come from `mol_payment_method` (`PaymentMethodRepository::getMethodsForCheckout`,
filtered on `enabled = 1` + environment + shop), not from `Configuration`. Rows are written by
`PaymentMethodService::savePaymentMethod`, which is only reached from the BO payment-methods
screen after that screen has pulled `GET /v2/methods` from the API.

Consequences:
- `MolliePsp.setup` seeds the rows directly by SQL (fast, unbreakable — spec §6.2's stated
  preference). Schema: `src/Install/DatabaseTableInstaller.php:64`.
- The module's own refresh path (`AdminMolliePaymentMethods`, `action=refreshMethods`) is
  covered by a custom spec instead, which is where `GET /v2/methods` genuinely gets exercised.
- `getMethodsForCheckout` also returns `[]` when `MOLLIE_STATUS_AWAITING` is unset, so the
  module's order states must be installed — they are, by `installModule`.

## 5. Order states — the spec's mapping was wrong

States the module installs (`src/Install/OrderStateInstaller.php`): `Partially refunded by
Mollie`, `Awaiting Mollie payment`, `Partially shipped`, `Completed`, `Order payment
authorized`, `Order payment shipped`, `Mollie Chargeback`. There is **no** "Mollie payment
canceled" state — spec §6.2 invented it.

Authoritative mapping, from `Config::getStatuses()` (Config.php:448) resolved through the
install defaults (`src/Install/Installer.php:192-197`):

| Outcome | Mollie status | Config key | Resolves to PS state |
|---|---|---|---|
| `paid` | `paid` | `MOLLIE_STATUS_PAID` = `PS_OS_PAYMENT` | **Payment accepted** |
| `authorized` | `authorized` | `MOLLIE_STATUS_PAID` (invoice-on-status default) | **Payment accepted** |
| `pending` | `open` / `pending` | `MOLLIE_STATUS_OPEN` = `MOLLIE_STATUS_AWAITING` | **Awaiting Mollie payment** |
| `failed` | `failed` | `MOLLIE_STATUS_CANCELED` = `PS_OS_CANCELED` | **Canceled** |
| `canceled` | `canceled` | `MOLLIE_STATUS_CANCELED` = `PS_OS_CANCELED` | **Canceled** |
| `expired` | `expired` | `MOLLIE_STATUS_EXPIRED` = `PS_OS_CANCELED` | **Canceled** |
| (full refund) | `refunded` | `MOLLIE_STATUS_REFUNDED` = `PS_OS_REFUND` | **Refunded** |
| (partial refund) | — | `MOLLIE_STATUS_PARTIAL_REFUND` | **Partially refunded by Mollie** |

## 6. Unsuccessful outcomes usually produce **no PrestaShop order at all**

This is the single biggest correction to the spec's test design.

```php
// src/Service/TransactionService.php:174-177, 212
$isPaymentFinished = MollieStatusUtility::isPaymentFinished($apiPayment->status);
if (!$isPaymentFinished && $isGeneratedOrderNumber) { return $apiPayment; }
...
if (!$orderId && $isPaymentFinished) { $orderId = $this->orderCreationHandler->createOrder(...); }
```

`isPaymentFinished` (`src/Utility/MollieStatusUtility.php`) is true only for `completed`,
`paid`, `shipping`, `authorized`, `paid_backorder`. So for `failed`, `canceled`, `expired` and
`open`, the webhook creates nothing and the cart stays a cart.

The one exception is **banktransfer**, which pre-creates the order at payment initiation
(`controllers/front/payment.php:126` → `OrderCreationHandler::createBankTransferOrder`) and so
does have an order to transition.

So `verifyOrderInBackOffice(expectedState: psp.expectedOrderState(outcome))` — the spec's
uniform matrix tail — is not universally applicable. See `DECISIONS.md` D-015 for how the
contract expresses "this outcome legitimately produces no order".

## 7. Refunds

BO refund → `AdminMollieAjax` `action=refund`/`refundAll` → `RefundService::handleRefund`
(`src/Service/RefundService.php`), which calls the SDK's `$payment->refund([...])` /
`refundAll()` → `POST /v2/payments/:id/refunds` (Payments API) or `POST /v2/orders/:id/refunds`
(Orders API). `handleRefund` first re-fetches with `?embed=refunds` (Payments) or
`?embed=payments,refunds` (Orders), so the mock must honour `embed`.

The refund call itself **does not change the PrestaShop order state**. State moves only when a
webhook re-fires and `TransactionService` sees `hasRefunds()` with
`amountRefunded >= amount` → `Refunded`, or `amountRefunded > 0` → `Partially refunded by
Mollie` (`TransactionService:200-207`). BO refund tests must therefore refund, assert the
outbound API call, then re-deliver the webhook before asserting state.

`handleRefund` special-cases a `409` "duplicate refund" — useful for the idempotency scenario.

## 8. TLS: the module pins its CA bundle (spec §6.4's mechanism does not work as written)

```php
// src/Adapter/API/CurlPSMollieHttpAdapter.php:98
curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($curl, CURLOPT_CAINFO, CaBundle::getBundledCaBundlePath());
```

`CURLOPT_CAINFO` is set per handle, which **overrides** `curl.cainfo` / `openssl.cafile` in
php.ini and ignores the OS trust store entirely. Baking the E2E CA into the image trust store
— what §6.4 item 2 specifies and what Phase 1 already built — therefore has no effect on
Mollie API calls: the handshake fails with `CURLE_SSL_CONNECT_ERROR`, the adapter retries 6
times and throws `CurlConnectTimeoutException`.

Spec §6.4 item 4 anticipated pinning only in the *provider SDK* and prescribed falling back to
a "provider-sanctioned test endpoint". Neither applies: the pinning is in the *module's* own
adapter, and there is no alternate endpoint to point at without changing module config.

Resolution (D-014): append the E2E CA to the bundle the module actually consults —
`vendor/composer/ca-bundle/res/cacert.pem` — as a post-`composer install` build step. That file
is a build artifact produced on the runner, not module source; `git diff` of the module source
stays empty, which is what the Phase 3 DoD requires. There is exactly one pinning site
(verified: `grep -rn 'CaBundle\|CURLOPT_CAINFO\|new MollieApiClient'` over `src`, `subscription`,
`shared`, `controllers`, `mollie.php` returns three lines, all in the two files above), so one
appended cert covers every outbound call.

## 9. Hosted checkout screen (sandbox mode)

Mollie's real test-mode status screen, per the module's own Cypress suite
(`cypress/e2e/ps8/*`, `cypress/support/commands.js`): status radios expose `value="paid"` /
`failed` / `canceled` / `expired` / `open`, and the submit control is `.button.form__button`.
iDEAL additionally shows an issuer list (`.payment-method-list`) before the status screen. The
mock's stand-in page mirrors this contract while also exposing proper roles and labels, so
`completeHostedCheckout` can use role-based locators (§7.1) in both modes.

`return.php:341` branches on `$transaction->mode === 'test'` for open/pending, so the mock must
report `mode: 'test'` on every payment and order.

## 10. Things deliberately out of scope for the pilot

Subscriptions (`subscription/`), Apple Pay direct, PayByBank cancellation, Cloudsync/Segment
analytics, and the "Connect with Mollie" OAuth screens (`AdminMollieAuthentication`). None are
on the §6.3 matrix. Segment analytics fires outbound HTTP on install; it targets
`api.segment.io`, which the mock overlay does not alias, so those calls fail harmlessly and are
swallowed by the module's error handler.

## 11. `bin/console cache:clear` fails in the dev environment once the module is installed

Reproducible in the container, module installed, nothing else done:

```
$ php bin/console cache:clear --no-interaction
 // Clearing the cache for the dev environment with debug true
In PsrCachedReader.php line 198:
  Warning: filemtime(): stat failed for
  /var/www/html/vendor/prestashop/autoload/src/Autoloader.php(113) : eval()'d code
```

Doctrine's cached annotation reader stats every class file to decide whether its cached
annotations are stale. The module is autoloaded through PrestaShop's `prestashop/autoload`
shim, which registers classes from `eval()`'d code, so the "file" Doctrine is handed is the
pseudo-path `...Autoloader.php(113) : eval()'d code` — which cannot be stat-ed. In the dev
environment PrestaShop turns warnings into exceptions, so the command aborts.

`--env=prod` does not run the staleness check and succeeds, which is why `installModule` has
always worked: the kit's `ShopCli.clearCache()` already passes `--env=prod` (and serialises
concurrent clears with `flock`). Only a direct `console('cache:clear')` hits this — as spec
§6.2's sketch does.

Consequences:
- `MolliePsp.setup` calls `shopCli.clearCache()`, and `clearCache()` is now part of the kit's
  `ShopCli` contract so no PSP implementation has to know which environment is safe.
- This is a **module-side bug worth reporting upstream**, not a test-harness problem: a merchant
  running `cache:clear` on a dev install hits exactly this. It is out of scope for the pilot —
  fixing it would mean changing module code, which Phase 3 forbids — so it is recorded here.

## 12. The card method needs Mollie Components turned off in mock mode

With `MOLLIE_SANDBOX_IFRAME` on (the module's default in test mode), the card payment option
renders Mollie's hosted card fields as iframes loaded from **`js.mollie.com`**, and
`views/js/front/mollie_iframe.js:128` intercepts the place-order submit to tokenise them:

```js
$mollieCardToken.closest('form').on('submit', function (event) {
    if (isResubmit || useSavedCardCheckbox.is(':checked')) { return }
    event.preventDefault();
    mollie.createToken().then(...)
```

Two independent problems for mock mode: the fields are fetched from the real internet, so the run
is no longer hermetic and cannot pass in an isolated CI network; and with no card entered there is
no token, so the intercepted submit never re-submits and the checkout silently stalls on the
payment step.

`MolliePsp.setup` therefore sets `MOLLIE_SANDBOX_IFRAME = 0`, which makes the card method use the
module's own `payScreen` redirect — the same hosted-checkout shape as every other method. This is
a merchant-facing setting that ships with the module, not a testability hook, so it does not
breach the "no module changes" constraint.

**Coverage this gives up, stated plainly:** the Components card-entry path is not covered by the
mock matrix. Covering it needs either outbound access to `js.mollie.com` (a sandbox-mode concern)
or a second mock service standing in for the Components CDN, which is Phase 5 work at the
earliest.
