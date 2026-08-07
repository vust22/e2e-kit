# DECISIONS

Deviations from, and choices left open by, `e2e-platform-spec.md` v1.1.0-draft.
Every entry: what was decided, why, and which spec section it resolves.

Format: `D-NNN — <title>` / **Spec ref** / **Decision** / **Why** / **Revisit when**.

---

## D-001 — PrestaShop image is installed at build time via a MariaDB server inside the builder stage

**Spec ref:** §4.1 item 2 (explicitly asks for this decision to be recorded).

**Decision:** `images/prestashop/Dockerfile` is a two-stage build. The `builder` stage
installs `mariadb-server` into the official PrestaShop image, starts `mysqld` locally,
runs PrestaShop's CLI installer (`install/index_cli.php`), applies the seed dataset SQL,
then dumps the database to `/seed/prestashop.sql` and leaves the installed
`/var/www/html` tree in place. The final stage copies both from the builder and ships a
`mysql-client` only (no server).

**Why:** The alternative — a buildx sidecar service — needs BuildKit features that are
not uniformly available on developer laptops and in GitHub-hosted runners, and it makes
the build non-reproducible from a plain `docker build`. Running `mysqld` inside the
builder stage keeps `docker build -f images/prestashop/Dockerfile .` as the single,
portable build command, which matters for Design principle 1 (boring over clever) and
for local/CI parity (Goal 7).

**Revisit when:** build time exceeds ~10 minutes or the official image drops Debian.

---

## D-002 — Release tooling is Changesets

**Spec ref:** §10 ("release-please or changesets — pick one, record in DECISIONS.md").

**Decision:** Changesets, with `linked` configuration so `@invertus/e2e-core` and
`@invertus/e2e-prestashop` always share one version (§10 requires version lock).

**Why:** Changesets models the "several packages, one version line" case natively via
`linked`/`fixed`; release-please treats each package as an independent release train and
would need extra configuration to hold them together.

**Note:** Not yet wired — Phase 1 is local-only (see D-006). The `.changeset/` directory
lands in Phase 2 with the release workflow.

---

## D-003 — All PrestaShop images are built and run as `linux/amd64`, including on Apple Silicon

**Spec ref:** §4.3 (silent on architecture).

**Decision:** `--platform linux/amd64` is pinned in the Dockerfile build command, the
compose files, and the CLI. On arm64 developer machines this runs under Docker Desktop's
emulation.

**Why:** `prestashop/prestashop:8.2.x-*` publishes **amd64 only** (verified against the
Docker Hub API on 2026-08-06); only 9.x is multi-arch. Building arm64 locally and amd64
in CI would mean the image a developer proves green is not the image CI runs — the exact
"green locally, red in CI" divergence Goal 7 exists to prevent. Emulation costs build and
boot time on laptops; CI (amd64 runners) is unaffected.

**Revisit when:** PrestaShop publishes arm64 for 8.x, or the emulated boot budget (§8.2,
90s) becomes unmeetable locally.

---

## D-004 — Pinned base image tags

**Spec ref:** §4.3 `build-matrix.json`.

**Decision:**

| Kit tag | Base image | PrestaShop | PHP |
|---|---|---|---|
| `8` | `prestashop/prestashop:8.2.2-8.1-apache` | 8.2.2 | 8.1 |
| `9` | `prestashop/prestashop:9.0.3-apache` | 9.0.3 | 8.4 (bundled) |

**Why release tags, not the `x` tags:** the spec's matrix reads `8.2.x-latest` / `9.x-latest`,
which look like the `8.2.x-*` Docker tags — but those are **branch** images whose entrypoint
(`docker_branch_run.sh`) clones and builds PrestaShop from source at *container start*. That
is slow, needs the network at boot, and is not reproducible. The release tags ship the source
pre-extracted with the ordinary `docker_run.sh` entrypoint, which is what this design needs.

**Why PS 9 has no PHP suffix:** PrestaShop 9 publishes per-PHP variants only on the branch
tags (`9.0.x-8.4-apache`). The stable release tags (`9.0.3-apache`) ship one bundled PHP —
currently 8.4. Pinning a PHP version for PS 9 would mean going back to a branch image, so the
matrix takes the bundled runtime instead.

**Verified:** both images build and the full example suite passes against each (8/8).

---

## D-005 — zod v4

**Spec ref:** §5.3 ("validated with zod").

**Decision:** zod `^4`. The config schema uses the v4 API (`z.output<typeof Schema>`,
`z.custom` for the PSP class reference).

**Why:** v4 is current; nothing in the spec depends on v3 semantics.

---

## D-006 — Phase 1 is local-only: no GHCR pushes, no npm publishing, no GitHub workflows

**Spec ref:** §12 Phase 1 DoD.

**Decision:** Phase 1 builds images to local tags (`e2e-ps:8`, `e2e-ps:9`) and wires the
workspaces by file link. GHCR names (`ghcr.io/invertus/e2e-ps:8`) are configured as the
default *remote* but are never pushed to in this phase; `--local` is the default for the
CLI. `.github/workflows/` is deliberately empty until Phase 2.

**Why:** Explicit instruction from the repo owner: prove the stack green on a laptop and
get sign-off before anything touches shared infrastructure. The spec's Phase 1 DoD is
itself stated in terms of a local run.

**Superseded by Phase 2 (2026-08-07).** `.github/` now holds `images.yml`, `release.yml`, `kit-ci.yml`,
`e2e-reusable.yml` and `e2e-selftest.yml`; images publish to `ghcr.io/vust22` (D-026) and packages to
GitHub Packages (D-025). The remote names moved from `invertus` to `vust22` for the dry run — see D-025
for how that reverses. Local tags and `--local` remain the CLI default, so the daily loop is unchanged.

---

## D-007 — Playwright pinned to 1.62.1

**Spec ref:** §3.2 ("Playwright pinned to an exact version and re-exported").

**Decision:** `@playwright/test` is an exact (non-range) dependency of
`@invertus/e2e-core` at `1.62.1`, re-exported from `@invertus/e2e-core`. Consumers must
not declare their own Playwright dependency; a lint rule and the config loader both check
for this.

---

## D-008 — TypeScript is compiled for kit packages, and type-stripped at runtime for consumer config

**Spec ref:** §5.3 (config is a `.ts` file), §3.2 (TS 5 strict).

**Decision:** `packages/*` compile to `dist/` with `tsc` and are consumed as JavaScript.
Consumer spec files stay TypeScript and are executed by Playwright's own transform.
`e2e.config.ts` must additionally be readable by the plain-Node CLI (before Playwright
runs, to compute the compose matrix) — the CLI imports it under Node's
`--experimental-strip-types`.

**Why:** Avoids a second TypeScript runtime (`tsx`/`ts-node`) as a dependency, and avoids
a bespoke config bundler. The cost is that `e2e.config.ts` must stay within the
type-stripping subset: no `enum`, no `namespace`, no parameter properties. This is
documented in `docs/ONBOARDING.md` and enforced by a lint rule.

**Revisit when:** Node makes type stripping non-experimental (then drop the flag), or a
consumer legitimately needs a construct outside the subset.

---

## D-009 — The E2E CA is generated per image build, not committed

**Spec ref:** §4.1 item 9, §6.4 item 2 ("key material generated at image build, never
reused outside CI").

**Decision:** `images/prestashop/e2e-ca/gen-ca.sh` generates the CA key + cert into an
un-tracked directory at build time; `.gitignore` excludes `*.key`/`*.crt`. The CA cert
(not the key) is baked into the image trust store. Mock services receive leaf certs signed
by the same CA, generated in the same step.

**Why:** A committed CA private key in a repo that consumers pull is a standing liability
even when scoped to CI networks. Regenerating per build costs ~1s.

**Consequence:** A locally built PS image and a locally built mock image must come from
the same build invocation (the CLI's `build` command does both) or TLS interception fails
with an unknown-issuer error. This is surfaced as an explicit, named error rather than a
generic curl failure.

---

## D-013 — PrestaShop consumers import `test` from the adapter package, not from core

**Spec ref:** §3.3 (core exports `test`/`expect`).

**Decision:** `@invertus/e2e-core` exports `test`/`expect` exactly as specified, with the
`storefront`/`admin`/`testOrder`/`shopCli` fixtures typed against the platform-neutral
interfaces. `@invertus/e2e-prestashop` re-exports the same `test`, overriding those four
fixtures so they are typed as the concrete PrestaShop facades. The overrides pass core's
value straight through — no behaviour changes, only types.

**Why:** Core cannot import the adapter (the dependency runs one way), so core's `test`
cannot know that `storefront` is a `Storefront` with a `checkout` page object on it. The
usual fix — TypeScript declaration merging — does not work here, because an interface can
only be augmented in the module that *declares* it, and consumers see it through core's
barrel re-export. Overriding the fixtures in the adapter is the plain, type-safe option
(Design principle 1).

**How to apply:** PrestaShop specs `import { test, expect } from '@invertus/e2e-prestashop'`.
Importing from core still works and still runs; only the autocompletion is poorer.

---

## D-012 — Image builds never download translation packs

**Spec ref:** §4.2 (languages `en` default, `lt` enabled).

**Decision:** The seeder creates additional languages as bare `Language` records. It does
not call the translation-pack download that `Language::checkAndAddLanguage` performs.
Untranslated strings fall back to English.

**Why:** Downloading a pack makes the image build depend on prestashop.com being up and
unchanged — a third-party dependency inside the one artifact that is supposed to make runs
deterministic (Design principle 3). The second language exists to exercise multi-language
code paths (URL prefixes, `id_lang` handling), not to assert Lithuanian copy.

**Observed at build time:** the installer's localization pack for the configured country
already installs `lt`, so the seeder logs "already installed" rather than creating it.

**Revisit when:** a test needs to assert translated strings — then bake the pack into the
image at build time from a vendored copy, still without a network call.

---

## D-011 — The seed dataset is applied by a PHP seeder using PrestaShop's object model, not by hand-written SQL

**Spec ref:** §4.2 ("Defined once in `packages/prestashop/src/seed/dataset.ts` and compiled
to SQL in `images/prestashop/seed/`").

**Decision:** `dataset.ts` remains the single source of truth, but it compiles to a **JSON
manifest** (`seed/manifest.ts`), not to SQL. At image-build time a PHP script
(`images/prestashop/seed/seed.php`) boots PrestaShop and creates the entities through
`ObjectModel` (`Product`, `Customer`, `Address`, `Carrier`, `TaxRulesGroup`, …). The
resulting database is then dumped to `images/prestashop/seed/prestashop.sql` and baked
into the image — so the image still ships SQL, and the fast `E2E_RESET_DB=1` reset path
(§4.1 item 6) works exactly as specified.

**Why:** Hand-written INSERTs for a PrestaShop product touch `ps_product`,
`ps_product_lang`, `ps_product_shop`, `ps_product_attribute*`, `ps_stock_available`,
`ps_category_product`, and `ps_specific_price` — and the exact column set differs between
PS 8 and PS 9. Generating that SQL from TypeScript would encode two schema versions in the
kit and break on every PrestaShop minor. Using the platform's own API means the platform
owns schema correctness, which is the whole point of an adapter.

**Guarantee preserved:** the seeder asserts that every created entity's id matches the id
declared in `dataset.ts` and fails the build on mismatch. That is what makes
`SEED.products.TSHIRT.id === 1` a build-time fact rather than a hope. The installer runs
with demo fixtures disabled so the id space starts clean.

---

## D-010 — Phase 1 payment coverage uses the bundled `ps_checkpayment` module

**Spec ref:** §12 Phase 1 DoD ("paying with default check payment"), which conflicts with
§4.1 item 4 ("`ps_checkpayment` disabled").

**Decision:** The image ships `ps_checkpayment` **installed but disabled** for the
storefront by default; the Phase 1 example suite enables it explicitly via `ShopCli` as
part of its own setup, and disables it again in teardown.

**Why:** The two spec statements are in direct tension. Resolving it in favour of "off by
default, on by explicit test action" keeps the seeded shop deterministic for payment
modules under test (no stray second payment option in the checkout list, which would make
`selectPaymentModule` ambiguous) while still allowing the Phase 1 DoD flow to run.

---

## D-014 — The E2E CA is appended to the Mollie module's vendored Composer CA bundle

**Spec ref:** §6.4 item 2 and item 4 (TLS interception; the "SDK pins certificates"
escape hatch).

**Decision:** After `composer install` produces the module's `vendor/` tree, the kit appends
`images/prestashop/e2e-ca/e2e-ca.crt` to `vendor/composer/ca-bundle/res/cacert.pem` in the
build output that gets mounted into the shop container. The OS trust store keeps getting the
CA too (Phase 1 behaviour, unchanged) — it is what PrestaShop core, Guzzle and plain `curl`
consult; the appended bundle is what the Mollie module consults.

**Why:** §6.4 assumes the only trust decision is the system one. The Mollie module ships its
own HTTP adapter which sets `CURLOPT_CAINFO` to `CaBundle::getBundledCaBundlePath()` on every
request (`src/Adapter/API/CurlPSMollieHttpAdapter.php:98`). A per-handle `CURLOPT_CAINFO`
overrides `curl.cainfo`/`openssl.cafile` and bypasses the OS store entirely, so the Phase 1
mechanism has no effect on Mollie API traffic — the handshake fails, the adapter retries six
times and throws `CurlConnectTimeoutException`. §6.4 item 4's prescribed fallback ("a
provider-sanctioned test endpoint") does not apply, because the pinning is in the module rather
than the SDK and there is no endpoint setting to repoint without editing module config.

Appending to that bundle is the same act as appending to the OS trust store, performed at the
path this module actually reads. It touches `vendor/`, which is a build artifact generated on
the runner from `composer.json` — not module source. The Phase 3 DoD ("`git diff` of the module
source is empty") is satisfied, and `vendor/` is git-ignored by the module anyway. It is also
provider-agnostic in the way that matters: the kit exposes it as a declarative
`module.trustBundles` list of paths within the built module, so a future module that pins
elsewhere names its own path instead of needing new kit code.

**Rejected alternatives:** patching the adapter (forbidden — module source); `LD_PRELOAD` or
iptables-level interception (opaque, platform-specific, and defeats Design principle 1);
running the mock over plain HTTP (the SDK hardcodes the `https://api.mollie.com` base URL, so
this needs module config).

**Revisit when:** the module switches to `CaBundle::getSystemCaRootBundlePath()`, or a provider
appears whose pinning is a compiled-in public key rather than a bundle file — the latter is a
genuine dead end and would force the §6.4 item 4 fallback.

---

## D-015 — `expectedOrderState` may return `null` to mean "no order should exist"

**Spec ref:** §3.6 (`PspContract.expectedOrderState`), §5.3 (the `checkout-matrix`
expansion), §6.3.

**Decision:** `expectedOrderState(outcome)` returns `string | null`. `null` asserts that the
outcome legitimately produced **no** PrestaShop order. `verifyOrderInBackOffice` gains a
matching `expectedState: string | null` and, for `null`, asserts the cart produced no order
rather than looking one up. The `checkout-matrix` tail becomes: `paid`/`authorized` →
verify state; `failed`/`canceled`/`expired`/`pending` → verify per whatever the PSP declares,
which for Mollie is `null` on every method except banktransfer.

**Why:** §5.3's matrix tail assumes every outcome yields an order to inspect. The Mollie module
only creates the PrestaShop order once the payment status is *finished* — `completed`, `paid`,
`shipping`, `authorized`, `paid_backorder` (`src/Utility/MollieStatusUtility.php`); for
`failed`, `canceled`, `expired` and `open` the webhook returns early and the cart stays a cart
(`src/Service/TransactionService.php:174`). Asserting "order exists in state Canceled" for those
outcomes would fail against correct module behaviour, and asserting nothing would leave 9 of the
12 matrix cells checking nothing at all.

This is not Mollie-specific: "an abandoned payment leaves no order" is normal PSP-module
behaviour, so it belongs in the contract rather than in a provider workaround. Making it an
explicit `null` rather than an optional assertion keeps it a *positive* assertion — the suite
still fails if a stray order appears.

Banktransfer is the exception and needs no special casing: it pre-creates the order at payment
initiation (`controllers/front/payment.php:126`), so `MolliePsp.expectedOrderState` returns a
state name when the method under test is banktransfer and `null` otherwise. The contract change
is what makes expressing that possible.

**Revisit when:** a second payment module is onboarded (Phase 5) — if its outcomes map
uniformly, check whether `null` is carrying its weight.

---

## D-016 — The Mollie consumer overlay is staged inside the kit, not written into the module clone

**Spec ref:** §5.1 (the consumer file set lives in the module repo), §12 Phase 3.

**Decision:** The exact §5.1 file set — `e2e/e2e.config.ts`, `e2e/psp/MolliePsp.ts`,
`e2e/specs/**`, `e2e/NOTES.md`, `.github/workflows/e2e.yml` — is authored under
`e2e-kit/pilots/mollie/`, and the Mollie clone at `/Users/justas/e2e-playbook/mollie-module`
is treated as strictly read-only module source. The kit's runner composes the two: module
source from the clone, consumer overlay from `pilots/mollie/`.

**Why:** The repo owner's standing instruction for this pilot is that the Mollie clone is not
to be written to at all — no commits, no adds, no new files. Staging the overlay in the kit
honours that while still validating the architecture end to end, because the overlay is a
drop-in: adopting it for real is `cp -r pilots/mollie/{e2e,.github} <module-repo>/` with no
edits. The layout is a delivery detail, not a design change.

**Cost, stated plainly:** the one thing this cannot verify is Phase 3's "Mollie repo PRs
blocked/green on mock matrix" DoD bullet, which needs a PR in the module repo — and which
already needed Phase 2's reusable workflow to exist. That bullet carries over to Phase 2, as
the Phase 1 handoff already anticipated.

**Revisit when:** the owner green-lights a branch in a fork of the module repo — then the
overlay moves verbatim and this entry becomes historical.

**Partially resolved (2026-08-07).** The fork `vust22/mollie` exists and the overlay has been copied
into it verbatim and committed on a local branch `e2e-kit-adoption` at
`/Users/justas/e2e-playbook/mollie-fork`, whose **push remote is deliberately set to `DISABLED`** — the
authorization for that session covered `vust22/e2e-kit` only. The copy confirmed the drop-in claim: it
added exactly `e2e/` and `.github/workflows/e2e.yml` and changed nothing else, and the only edits needed
were the `uses:` owner and two alias devDependencies (D-025).

One imprecision in the original entry, worth recording: `e2e/e2e.config.ts` is
`source: process.env.MOLLIE_MODULE_SOURCE ?? '.'`, not a literal `source: '.'`. It works unchanged in a
real module repo because the fallback resolves correctly, but it does carry one line of kit-side
scaffolding a real consumer would not want. It was left byte-identical rather than cleaned, because
"the overlay is a verbatim drop-in" is the property this entry claims and diverging the two copies
would defeat the test.

**Still open** until that branch is pushed and its PR runs green — the last Phase 3 carry-over bullet
("Mollie repo PRs blocked/green on mock matrix"), and the cross-repository gap D-027 records.

---

## D-017 — `PspContract` gains optional capabilities, and shared suites skip what a PSP does not implement

**Spec ref:** §3.6 (the contract), §6.3a (the back-office order-management suite).

**Decision:** Four optional members on `PspContract`: `paymentOptionLabel`,
`refundFromBackOffice`, `apiCalls`, `expectedRefundState`, plus `forceProviderStatus`. Shared
suites call them when present and skip — with a stated reason — when not. Everything mandatory in
§3.6 stays mandatory.

**Why:** §6.3a makes back-office order management a *shared* suite, but four of its six scenarios
need knowledge no platform adapter can have: which control refunds an order in this module's own
BO panel, what the module's request to the provider should look like, and which state a settled
refund lands in. The alternatives were both worse than an optional member: putting that knowledge
in the kit would be exactly the provider-specific code §3.6 exists to prevent, and dropping the
scenarios would lose the assertions §6.3a asks for by name.

`paymentOptionLabel` is the same shape of problem one level down. `CheckoutPage.selectPaymentModule`
assumed a module contributes exactly one payment option; most payment modules contribute one per
method, and the label is not derivable from the method id — Mollie labels `creditcard` as "Card".

**Why optional rather than required:** a non-payment module implements none of this, and a payment
module without a BO refund widget should not have to stub one. "Skipped, because the PSP does not
implement `refundFromBackOffice`" is honest; a stub that silently passes is not.

**Revisit when:** the second payment module is onboarded (Phase 5). If it implements all of them,
they are not really optional and should move into the required surface.

---

## D-018 — `testOrder.createOrder` drives the browser; §6.3a's <5s target is not met

**Spec ref:** §6.3a ("performs cart creation + payment initiation through the shop's HTTP
endpoints without a full browser session where possible … Target: <5s per order").

**Decision:** `createOrder`/`createPaidOrder` produce a real order in the requested state by
driving the same browser checkout as `viaCheckout` and delegating the provider legs to the PSP.
The guarantee §6.3a states — "a real order in the requested state" — holds. The performance
target does not: an order costs roughly 8–14s, not <5s.

**Why:** the fast path §6.3a imagines needs cart creation and payment initiation over plain HTTP.
In PrestaShop the cart is bound to a front-office session and the module's payment controller
resolves the cart from that session, so a session-less client would have to reimplement
PrestaShop's checkout handshake inside the kit — a large piece of platform-version-specific code
whose failure mode is silently producing orders that differ from real ones. That is a poor trade
against saving a few seconds per test in a suite whose slowest step is a container.

**What this costs:** the back-office suite is ~1 minute slower than the spec envisaged. Nothing
else changes.

**Revisit when:** the BO suite grows past ~10 scenarios, or CI wall-clock becomes the binding
constraint. The cheapest real speed-up is probably a platform-side PHP order factory invoked
through `ShopCli`, which keeps the session problem inside PrestaShop where it belongs.

---

## D-019 — Shop-mutating setup runs once per run, coordinated on disk

**Spec ref:** §3.6 ("`setup` … called once before the suite"), §7.2 (every test must pass in
isolation and under `--fully-parallel`).

**Decision:** Module installation and `psp.setup` run exactly once per run, coordinated across
Playwright worker processes by `runOnce` (`packages/core/src/env/once.ts`) using an atomic `mkdir`
lock and a result marker in the consumer's `.e2e-kit/`. Both are exposed as worker fixtures, so
every suite gets an installed, configured module without depending on the `install` suite having
run first.

**Why:** the obvious implementation — a worker-scoped fixture — runs N times in parallel against
one shared shop. Concurrent `cache:clear` breaks the cache for every worker, concurrent module
installs corrupt the module's tables, and the resulting failures point everywhere except at the
cause. §3.6's "once before the suite" is a per-run statement, and the per-worker reading was the
deviation.

Worker processes cannot share memory, so the coordination has to be on disk. `mkdir` is atomic
everywhere we run, which makes it a lock with no new dependency. Failures are recorded in the
marker as well as successes, so the other workers fail fast with the original error instead of
each waiting out the full timeout.

**Revisit when:** a suite legitimately needs per-worker isolated shop state — at which point the
answer is probably a shop per worker, not a smarter lock.

---

## D-020 — The Mollie module needed no test selectors added

**Spec ref:** §7.1 item 3 ("when a locator heals repeatedly, the durable fix is adding a
`data-testid` to the module/theme template — we control those codebases").

**Decision:** No `data-testid` attributes were added to the Mollie module, and none are needed for
the pilot. The back-office panel already ships stable ids, and `MolliePsp` uses those:
`#mollie-refund-amount`, `#mollie-initiate-refund`, `#mollieRefundModal`,
`#mollieRefundModalConfirm`, `.mollie-order-info-panel` — all from
`views/templates/hook/order_info.tpl` and bound in `views/js/admin/order_info.js`.

**Why this is worth recording:** the module's own Cypress suite drives the same panel through
styled-components class hashes (`.sc-htpNat`, `.sc-bxivhb` in `cypress/support/commands.js`).
Those are build output — a dependency bump regenerates them — and copying them was the original
mistake here: the first `refundFromBackOffice` was written from that suite and matched nothing,
which then got misdiagnosed as "the panel does not render". Reading the module's own template
instead produced selectors that are both stable and readable.

The offer to add selectors stands for cases where a control genuinely has no stable hook. So far
the module has one everywhere the pilot needs.

**Revisit when:** a locator here fails on a module upgrade — at which point adding a `data-testid`
upstream is the right fix under §7.1, not a cleverer selector.

---

## D-021 — Provider attempt key and platform order reference are distinct, everywhere

**Spec ref:** §3.6 (`ensureWebhookProcessed(orderReference)`), §7.4 ("order references are captured
from the confirmation page").

**Decision:** Two identifiers travel through the suites, and they are never interchangeable:

- `HostedCheckoutResult.reference` — the **provider's** handle on the attempt, passed to
  `ensureWebhookProcessed` and to the mock's control plane. For Mollie this is the module's
  generated `mol_<hash>` order number.
- `TestOrderRef.reference` — the **platform's** order reference, read from the confirmation page
  once the order exists, and the only thing a back-office lookup accepts.

`TestOrderRef.providerPaymentId` carries the first alongside the second, so a suite that needs both
has both.

**Why:** the module sends Mollie a placeholder at payment-creation time, because no PrestaShop
order exists yet, and PrestaShop assigns the real 9-letter reference only when the webhook creates
the order. Conflating them is a silent, expensive mistake: passing `mol_…` to a back-office search
fails 15 seconds later as "no order row found", which reads like a missing order rather than a
wrong key. It cost most of a debugging session and produced a confidently wrong diagnosis
("the module's panel does not render") before the actual cause surfaced.

**Revisit when:** never, ideally — but if a future PSP's provider key *is* the platform reference,
resist collapsing the two. The distinction is what makes the failure mode impossible.

---

## D-022 — The mock answers unknown endpoints in Mollie's error shape

**Spec ref:** §6.4 (mock endpoint list, "extend as the module requires").

**Decision:** `setNotFoundHandler` returns Mollie's `{status,title,detail}` envelope and records
the call with `unimplemented: true`, so `GET /__admin/requests` names any endpoint the module
needs that the mock lacks.

**Why:** Fastify's default 404 body has an `error` key, and the module's adapter reads
`$body->error->message` whenever one is present
(`src/Adapter/API/CurlPSMollieHttpAdapter.php:222`). On a Fastify 404 that resolves to `null`, so
a missing endpoint surfaced inside PrestaShop as an `ApiException` with an **empty message** — no
method, no path, nothing. The endpoint in question was `PATCH /v2/payments/:id`, which the module
uses to replace its placeholder description with the real order reference, and which it calls
*outside* a try/catch in the refund path — so the whole refund flow failed with
`"Failed to handle webhook"` and no indication of why.

**Revisit when:** onboarding the next provider mock — this handler is worth copying before writing
a single endpoint, because it turns "something is missing" into "this exact call is missing".

---

## D-023 — Run reports are downloadable zip artifacts, not gh-pages

**Spec ref:** §8.1 ("report ... publish HTML to gh-pages `/e2e/<run-id>/`, PR comment with summary +
link").

**Decision:** The `report` job merges every shard's blob report, bundles the HTML report,
`summary.json`, `junit.xml` and any captured container logs, and uploads one zip per mode
(`e2e-report-mock-<run_id>`, `e2e-report-sandbox-<run_id>`). No `gh-pages` branch is created and
GitHub Pages is not enabled anywhere. The PR comment carries the full per-project pass/fail/skip table
**inline** instead of a link.

**Why:** the reusable workflow runs under the *consumer's* `GITHUB_TOKEN`, so the only gh-pages it
could write to is the consumer's own — and the pilot consumer is a fork of someone else's public
repository, where pushing a `gh-pages` branch is invasive. Artifacts also behave identically on private
repositories and on the Free plan, whereas Pages requires a paid plan for private repos; that means the
report path does not have to change when the kit moves to its permanent org. It also shrinks the
workflow's permissions to `pull-requests: write`, with no `contents: write` on the caller.

**Consequence, stated plainly:** a Playwright HTML report cannot be opened from `file://`, so a
reviewer downloads, unzips and runs `npx playwright show-report merged-report` — one step more than
clicking a link. The inline PR table is what keeps that cost off ordinary triage: only trace-level
debugging needs the download. Artifacts expire after 30 days (§8.2's own retention figure), so there is
no long-term report history to compare runs against. Nothing in Phases 2–3 depends on that, and §9.6's
healing telemetry uses separate JSON-line artifacts.

**Two zips rather than one merged view** because the Playwright project name encodes the platform
version (`chromium-ps8`) but not the mode, so a mock shard and a sandbox shard of the same version
would be indistinguishable in one merged report. Splitting also mirrors §8.3's blocking/non-blocking
split.

**Revisit when:** the kit lives in an org where a shared, permanent report host is available and
consumers want run history — then this becomes an additional publish target, not a replacement.

---

## D-024 — `ENV_BOOT_FAILED` marks a boot failure; exceeding the boot budget only warns

**Spec ref:** §8.2 ("healthcheck-ready target < 90s. If exceeded, fail fast with a distinct
`ENV_BOOT_FAILED` annotation so healing never triggers on environment failures").

**Decision:** `e2e-mock` times the boot step. A genuine boot failure or timeout emits
`::error title=ENV_BOOT_FAILED` and fails the job. Merely exceeding 90s while booting successfully
emits `::warning title=Boot over budget` and the job continues.

**Why:** read literally, the spec fails an otherwise-green run because boot took 95 seconds. The
annotation's stated purpose is the clause that follows it — *"so healing never triggers on environment
failures"* — which is about §9.1 classification, not about enforcing a latency SLO. A boot that
succeeded is not an environment failure, however slow it was, and marking it as one would suppress
healing on a run where healing is valid.

**Consequence:** the 90s budget is observable but not enforced. If boot time needs to be a hard gate
later, it should be a separate explicit check with its own annotation, so the healing classifier keeps
one unambiguous signal.

---

## D-025 — Packages publish as `@vust22/*` through a publish-time scope remap

**Spec ref:** §10 (npm packages version-locked, consumed via Renovate), §11 (secrets table lists
`GHCR` access via `GITHUB_TOKEN` and no `NPM_TOKEN`).

**Decision:** the two packages are published to GitHub Packages (`npm.pkg.github.com`) as
`@vust22/e2e-core` and `@vust22/e2e-prestashop`. Every `package.json` and every one of the 51 source
files that import them keeps the `@invertus/*` name. `scripts/prepare-publish.mjs` stages each package
into a temp directory and rewrites exactly two things in the copied manifest:

1. `name` → `@vust22/<base>`
2. each `@invertus/e2e-*` **runtime** dependency → an npm alias, keeping `@invertus/...` as the key and
   pointing it at `npm:@vust22/...@<version>`

`scripts/publish-all.mjs` publishes from the staging directories. Consumers declare the same alias
shape in their own `package.json`.

**Why GitHub Packages at all:** §11's secrets table budgets for `GHCR` access via `GITHUB_TOKEN` and
lists no `NPM_TOKEN`, so the design already assumed the GitHub registry. GitHub Packages then requires
the npm scope to match the repository owner, which a `vust22`-owned repo cannot satisfy for
`@invertus/*`.

**Why remap at publish time rather than rename in the repo:** the 51 importing files resolve through a
workspace symlink keyed on the package name. Renaming the `name` fields breaks every local import,
every example, and the pilot — a wide diff that would have to be reverted on the move to the real org.

**Why edit 2 is load-bearing:** the compiled `dist` still contains `import '@invertus/e2e-core'`. A
published package whose dependency were plainly `@vust22/e2e-core` would install to a path its own code
never looks at, and would resolve nothing at runtime. The alias installs the published package *at the
path the compiled imports expect*.

**Consequence:** GitHub Packages authenticates even public reads, so local installs need a
`read:packages` PAT in `~/.npmrc`. CI does not — the reusable workflow supplies `NODE_AUTH_TOKEN`
itself, which is what keeps consumers at the §5.1 two-file adoption.

**Revisit when:** the kit moves to its permanent org and can publish `@invertus/*` directly. Deleting
`scripts/prepare-publish.mjs` and `scripts/publish-all.mjs` and dropping the consumer aliases is the
entire migration; no source changes.

---

## D-026 — Images publish as matched sets sharing one tag suffix

**Spec ref:** §4.1 item 9, §8.2, and DECISIONS.md D-009.

**Decision:** `images.yml` is a single job that runs `scripts/build-image.mjs --all` once and pushes
every resulting image under one shared tag suffix (`e2e-ps:8-<sha7>`, `e2e-ps:9-<sha7>`,
`e2e-mock-mollie:<sha7>`), plus moving `-main` aliases. `e2e-reusable.yml` takes a single `image-set`
input and derives all three refs from it.

**Why:** D-009 generates the E2E CA per build, and the provider mock serves an `api.mollie.com` leaf
signed by that same CA. A per-image build matrix would produce two CAs, and the shop container would
reject the mock's certificate. The failure surfaces as an unknown-issuer error deep inside the module's
HTTP adapter after a retry storm — which looks like almost anything other than a build-orchestration
problem. Deriving every ref from one value makes a mismatched pair unrepresentable rather than merely
discouraged.

**Consequence:** the images cannot be rebuilt independently. A change to the mock alone still
republishes the platform images, which on native amd64 runners is a few minutes and worth the
guarantee.

---

## D-027 — The reusable workflow is proven by an in-kit caller, not a consumer repository

**Spec ref:** §12 Phase 2 DoD ("`examples/consumer-module` moved through the real adoption path — 2
files added, matrix runs green on a PR in a scratch repo").

**Decision:** `e2e-selftest.yml` lives in the kit and calls `e2e-reusable.yml` via
`uses: ./.github/workflows/e2e-reusable.yml` against `examples/consumer-module`. That is the Phase 2
evidence for the reusable workflow. No scratch repository is created.

**Why:** the repo owner's authorization on 2026-08-07 covers local work and `vust22/e2e-kit` only —
explicitly not `vust22/mollie`, which was to have been the stronger proof. `examples/consumer-module`
lives inside the kit, so satisfying the DoD's "scratch repo" wording literally would require standing
up a third repository, which the same boundary rules out.

**Consequence, stated plainly:** this proves matrix expansion, package installation, the published image
pull, blob merging, the report zip and the summary — but **not the cross-repository path**, where the
token, the package read and the image pull are all cross-repo. **Phase 2 is therefore not DoD-complete.**
The gap is recorded in `docs/HANDOFF.md` as the first thing to close.

**Revisit when:** the owner green-lights pushing the Mollie fork branch. The overlay is already
committed locally at `/Users/justas/e2e-playbook/mollie-fork` on `e2e-kit-adoption`; pushing it and
opening the PR closes both this entry and the last Phase 3 carry-over bullet.

---

## D-028 — Four Phase 2 bugs only CI could surface, and what they say about the selftest

**Spec ref:** §8.1, §8.2, §10; DECISIONS.md D-027.

**Context:** every Phase 2 workflow was YAML-validated and its non-trivial logic unit-tested offline
before the first push. Four defects still survived to the first real runs. Recording them because each
one is a class of mistake that offline verification structurally cannot catch, and because two of them
are evidence about D-027 rather than mere bugs.

1. **`changesets/action`'s `published` output is derived by parsing stdout.** It looks for the
   `New tag:` lines `changeset publish` emits. Publishing through a staging directory (D-025) never
   produces them, so the output was always false and the release job **silently skipped tagging** —
   packages published at `0.2.0` with no `v0.2.0` and no `v1`. Since consumers pin `@v1` and the
   `report` job checks out `ref: v1`, nothing downstream could have worked. Fixed by gating on a
   `publish-result.json` the publisher writes itself; the missing tags were created by hand once.

2. **Identically-named artifacts silently overwrite when flattened.** Every shard's blob artifact
   contains `report-1.zip`. A plain `cp` into one directory keeps one and discards the rest, and the
   merged report then shows a *fraction* of the tests **as though the run were complete** — a
   green-looking report that is quietly wrong. Fixed with a unique prefix per artifact.

3. **`**/blob-report` matched `node_modules`.** npm workspaces symlink the consumer package into
   `node_modules/@invertus/<name>`, so the glob collected the same reports twice at a different depth.
   Fixed by uploading the consumer's `blob-report` explicitly.

4. **Two failures were the selftest not being a real consumer** — and this is the part that matters
   beyond the fixes. Inside the kit, `npx e2e-kit` resolves through the workspace to
   `packages/core/bin/e2e-kit.js`, whose `dist/` does not exist after a bare `npm ci`, so the CLI died
   with `ERR_MODULE_NOT_FOUND`; and `e2e-kit test` looks for `playwright.config.ts` in the working
   directory, which is the repo root for a real consumer but not for `examples/consumer-module`. The
   first needed a **kit-only** compile step guarded on `github.repository`; the second was fixed
   generally, by deriving the consumer root from `config-path`.

**Why item 4 is the important one:** a workflow step that exists *only* when the caller is the kit is a
seam, and it is exactly the seam D-027 predicted. The selftest proves the job graph, the matrix, the
image pull, the merge and the report. It does not prove the cross-repository path, and it needed a
kit-shaped exception to pass at all. **That step should be deleted the moment the Mollie fork PR runs
green**, and its presence is the clearest signal that Phase 2's DoD is still open.

**What offline verification did catch**, for calibration: the report reducer's aggregation, the
flatten's collision behaviour once suspected, the manifest remap, and the matrix expansion. All four
misses above were *integration* facts — another action's output contract, `upload-artifact` rooting
behaviour, npm workspace resolution, and cwd — none of which are visible from a YAML parse or a unit
test.
