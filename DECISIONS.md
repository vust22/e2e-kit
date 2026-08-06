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
