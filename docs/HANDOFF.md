# Handoff

Everything a fresh session needs to pick this up. Read `README.md` first for what the kit
is; this file is only the things that are true about *this machine and this moment* and are
not derivable from the code.

Last updated: 2026-08-07, end of a Phase 2 implementation pass.

> **Read this first: three things are waiting on you.** All three are blocked on authorization or
> credentials, not on work. See "What the repo owner needs to do" below.
>
> 1. The Phase 2 workflows are **committed locally but not pushed** — the `vust22` token lacks the
>    `workflow` scope and GitHub rejects the push.
> 2. The Mollie fork overlay is **committed locally with its push remote disabled**.
> 3. Because of (1), **no workflow has ever run**, so Phase 2 is not verified and not DoD-complete.

---

## Source of truth

- **Spec:** `/Users/justas/Downloads/e2e-platform-spec.md` (v1.1.0-draft). It is the single
  source of truth; the repo implements it. Read §0 before starting a phase.
- **Deviations:** `DECISIONS.md`, entries D-001 … D-019. Add a new entry for any further
  deviation rather than silently diverging. D-014 … D-019 are all Phase 3.
- **Verified module facts:** `pilots/mollie/e2e/NOTES.md` — resolves the §6.1 agent note, and is
  the first thing to read before touching anything Mollie-shaped.
- **Conventions:** `CONTRIBUTING.md` (mirror of spec §7).

## State as of this handoff

**Phase 1 and Phase 3 (mock mode) are complete and verified green. Phase 2 is written but unverified**
— every workflow exists and is committed, none has ever executed.

| Phase | State |
|---|---|
| 1 — kit skeleton, packages, seeded PS 8/9 images, compose, CLI | done, 8/8 green on both PS 8 and PS 9 |
| 2 — CI, publishing, onboarding | **written, committed locally, never run.** Five workflows + composite action + `ci-matrix` command + scope remap + ONBOARDING.md. Push blocked on the `workflow` token scope; **not DoD-complete** (D-027) |
| 3 — Mollie pilot | mock mode complete and green on PS 8 + PS 9 (31/31, re-verified 2026-08-07); sandbox not yet run; fork overlay staged locally, unpushed |
| 4 — self-healing | export surface only; `healingReporter` **throws if enabled**. See "Phase 4 notes" below — the spec's model and `temperature` need updating |
| 5 — second module onboarding | not started |

### Git

`origin` is `https://github.com/vust22/e2e-kit.git` (HTTPS, via the `gh` credential helper — see the
SSH note below). The repo is **public**. Default branch `main`.

**Pushed:** the four commits that landed Phase 3 and the design docs, plus `ci-matrix` and the release
tooling — seven commits total.

**Committed but NOT pushed:** one commit, `ci: images, release, kit-ci, reusable job graph and selftest
workflows`. GitHub rejects it:

```
! [remote rejected] main -> main (refusing to allow an OAuth App to create or update
  workflow `.github/workflows/e2e-reusable.yml` without `workflow` scope)
```

**Why SSH does not work here.** `ssh -T git@github.com` authenticates as **`justelis22`**, not
`vust22`, and `justelis22` has no write access to `vust22/e2e-kit`. While the repo was private this
presented as a confusing `ERROR: Repository not found`. The remote is therefore HTTPS, which uses the
`gh`-stored `vust22` token — and that token is missing the `workflow` scope. An SSH key registered to
`vust22` would also solve it (SSH pushes are not scope-limited), but adding a credential to your GitHub
account is not something an autonomous session should do on your behalf.

The Mollie module clone at `/Users/justas/e2e-playbook/mollie-module` remains **read-only by standing
instruction** and was not touched. A separate clone of the fork now exists at
`/Users/justas/e2e-playbook/mollie-fork` with the overlay committed on `e2e-kit-adoption` and its
**push remote set to `DISABLED`** as a guard.

Nothing is published yet: no image has been pushed to GHCR and no package to GitHub Packages, because
both happen from workflows that cannot be pushed. Local tags (`e2e-ps:8`, `e2e-ps:9`,
`e2e-mock-mollie:latest`) and workspace file links are unchanged, so the daily loop works exactly as
before.

---

## What the repo owner needs to do

**1. Grant the token the scopes it needs, then push.** One command, then one push:

```bash
gh auth refresh -h github.com -s workflow,write:packages,read:packages
cd /Users/justas/e2e-playbook/e2e-kit
git push origin main
```

**2. Run the workflows in this order.** They have dependencies: the reusable workflow pulls published
images, and the consumer stub pins `@v1`, which does not exist until a release runs.

```bash
gh workflow run images.yml --repo vust22/e2e-kit      # publishes the matched image set
# then make both GHCR packages public so a consumer's own token can pull them:
gh api -X PATCH /user/packages/container/e2e-ps          --field visibility=public
gh api -X PATCH /user/packages/container/e2e-mock-mollie --field visibility=public

# release.yml runs automatically on the push above and opens a "Version Packages" PR.
# Merge it — that publishes the packages and moves the floating v1 tag.
gh pr list --repo vust22/e2e-kit

gh workflow run e2e-selftest.yml --repo vust22/e2e-kit   # proves e2e-reusable.yml end to end
```

`kit-ci.yml` fires on the next PR by itself. **Expect to iterate** — none of these has ever executed,
so treat the first runs as debugging, and read a failing job's log before editing the workflow.

**3. Push the Mollie overlay and open its PR** — the last Phase 3 carry-over bullet, and the only thing
that closes the cross-repository gap in D-027:

```bash
cd /Users/justas/e2e-playbook/mollie-fork
git remote set-url --push origin https://github.com/vust22/mollie.git   # re-enable the guard
git push -u origin e2e-kit-adoption
gh pr create --repo vust22/mollie --base master \
  --title "test(e2e): adopt the Invertus E2E kit" \
  --body "Adopts the kit via the 2-file integration. Fires e2e-reusable.yml@v1 on the mock matrix."
```

Then protect `master` requiring `e2e-mock (ps-8)` and `e2e-mock (ps-9)` — and **not** the sandbox jobs
(§8.3).

**Expected result of that PR:** `31 passed, 3 skipped` on both platform versions, matching the local
run exactly. Any divergence is a real finding about the cross-repo path, not noise.

## Environment gotchas on this machine

- **Node.** The default `node` on PATH is **v20**; this project needs 22. Every command in
  the Phase 1 session was run with:
  ```bash
  export PATH="/Users/justas/.nvm/versions/node/v22.19.0/bin:$PATH"
  ```
  `nvm use` also works (`.nvmrc` says 22).
- **Architecture.** Apple Silicon. All images are built and run as `linux/amd64` under
  emulation, deliberately (DECISIONS.md D-003). Builds take ~2 min for PS 8, ~3 min for PS 9.
- **`timeout(1)` is not installed** (BSD userland). Use background execution instead.
- **Image rebuilds are required** after any change to `images/**` or
  `packages/prestashop/src/seed/**`:
  ```bash
  node scripts/build-image.mjs --ps 8     # or --all
  ```
  The build regenerates `images/prestashop/seed/manifest.json` from `dataset.ts`, so the
  adapter package must compile first — the script does that itself.

## The daily loop

For the kit's own example module (Phase 1's acceptance path):

```bash
export PATH="/Users/justas/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/justas/e2e-playbook/e2e-kit
npx tsc --build                      # after editing packages/**
cd examples/consumer-module
node ../../packages/core/bin/e2e-kit.js up --ps 8 --mode mock
node ../../packages/core/bin/e2e-kit.js test [--grep "..."]
node ../../packages/core/bin/e2e-kit.js reset-db     # between iterations
node ../../packages/core/bin/e2e-kit.js down
```

For the Mollie pilot:

```bash
export PATH="/Users/justas/.nvm/versions/node/v22.19.0/bin:$PATH"
export MOLLIE_MODULE_SOURCE=/Users/justas/e2e-playbook/mollie-module
cd /Users/justas/e2e-playbook/e2e-kit/pilots/mollie

node ../../packages/core/bin/e2e-kit.js prepare-module          # composer install + CA patch
node ../../packages/core/bin/e2e-kit.js up --ps 8 --mode mock --reuse-module
node ../../packages/core/bin/e2e-kit.js test --grep "checkout-matrix"
node ../../packages/core/bin/e2e-kit.js down
```

`MOLLIE_MODULE_SOURCE` is what points `module.source` at the read-only clone; without it the
config resolves `.` — correct inside the real module repo, wrong here (D-016).

**After a `reset-db`, delete the run-once markers** or the next run will believe the module is
still installed when the reset has just dropped its tables:

```bash
find .e2e-kit -maxdepth 1 -name '.once-*' -exec rm -rf {} +
```

**Verifying the TLS interception directly** — worth doing first whenever Mollie API calls start
failing, because it separates "the mock is wrong" from "the module cannot reach the mock":

```bash
docker exec e2e-mollie-ps8-shop-1 php -r '
require "/var/www/html/modules/mollie/vendor/autoload.php";
$p = \Composer\CaBundle\CaBundle::getBundledCaBundlePath();
$ch = curl_init("https://api.mollie.com/v2/methods/all");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CAINFO, $p);
$out = curl_exec($ch);
echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE), " ", (curl_error($ch) ?: "ok"), "\n";'
```

`200 ok` means DNS alias, TLS, the E2E CA and the patched bundle are all correct.

The mock's control plane is reachable from the host on `:8090` — `GET /__admin/state` dumps
everything it has seen, which is usually faster than a trace when a checkout misbehaves.

`e2e-kit doctor` reports docker, node, built images and whether a stack is running.

Editing `packages/**` needs only `tsc --build` — the specs resolve the workspace packages
through symlinks, so there is no reinstall step.

## Phase 1 findings that cost real time — do not rediscover them

All four are documented in comments next to the code, but they are the kind of thing that
looks like a different problem when it recurs:

1. **`ps_module_carrier`** — PrestaShop filters payment modules at checkout by the cart's
   carrier. A carrier created after a payment module was installed is not associated with
   it, and the symptom is *"Unfortunately, there is no payment method available"* with no
   error anywhere. Handled in `seed.php` and in `e2e-config carriers-allow`, which
   `installModule` calls for every module.
2. **overlayfs directory rename** — PS 9's installer renames `admin/` to a random name and
   fails with "Invalid cross-device link" if the directory still lives in a lower image
   layer. `install.sh` forces a copy-up first.
3. **Concurrent `cache:clear`** — two Playwright workers clearing the cache at once break
   each other. `ShopCli.clearCache` serialises with `flock` inside the container.
4. **PS 9 Module Manager** — the legacy `?controller=AdminModules` URL renders an empty
   shell on PS 9 (no grid, no error). `AdminPanel.goToModules` takes the Symfony route from
   the sidebar link instead.

## Phase 3 findings that cost real time — do not rediscover them

1. **The module pins its CA bundle.** `CURLOPT_CAINFO` → `CaBundle::getBundledCaBundlePath()`
   overrides php.ini and the OS trust store, so baking the E2E CA into the image does nothing for
   Mollie traffic. Fixed by appending the CA to the vendored bundle at build time (D-014). Symptom
   if it regresses: every Mollie call fails after a ~12s retry storm inside `CurlPSMollieHttpAdapter`.
2. **"Place order" is not inside a form.** The theme binds a delegated click handler that submits
   the *selected* option's form, and it bails silently — no error, no request, page unchanged — if
   the option is not checked at the instant of the click. Mollie refreshes part of the payment step
   over ajax, so a click landing mid-refresh does nothing at all. `CheckoutPage.placeOrder` now
   waits for the refresh and asserts that navigation happened. This one took the longest to find
   because *nothing* is logged anywhere.
3. **Every numeric column in `mol_payment_method` must be written.** A NULL runs through
   `prestashop/decimal`, throws, and the module catches it and silently drops the method from
   checkout. Visible only as `PaymentMethodRestrictionValidation has caught error: "" cannot be
   interpreted as a number` in `ps_log`.
4. **The orders grid's status is in `td.column-osname`.** Reading "the last cell with text" gets
   the actions column and compares an order state against the icon ligature `zoom_in`.
5. **Shop-mutating setup must run once per run, not once per worker** (D-019). Concurrent
   `cache:clear` from parallel workers fails in ways that look like anything but concurrency.
6. **`cache:clear` in the dev environment fails outright** once the module is installed — a real
   module-side bug, documented in NOTES.md §11. Always go through `ShopCli.clearCache()`, which
   uses `--env=prod`. And never run it as root: it leaves root-owned cache files and the whole
   storefront 500s until `chown -R www-data:www-data /var/www/html/var`.

Also: PrestaShop module class names keep underscores and capitalise each segment
(`e2e_consumer` → `E2e_Consumer`); getting it wrong surfaces as a `TypeError` deep inside
`ModuleRepository`.

## What each remaining phase needs

### Phase 3 — Mollie pilot (spec §6)  ← IN PROGRESS

**The module:** `mollie/PrestaShop` release 6.4.4, cloned read-only to
`/Users/justas/e2e-playbook/mollie-module`. Read `pilots/mollie/e2e/NOTES.md` before anything
else — it resolves the §6.1 agent note with file-and-line citations and corrects several things
the spec guessed wrong (order-state names, the API key format, the webhook's `security_token`
requirement, and the fact that refused payments create no order at all).

**What exists and is proven working:**

- `images/mollie-mock/` — Fastify mock of the Mollie `/v2` API: payments, orders, refunds,
  captures, shipments, methods, the stand-in hosted-checkout page, and the `__admin` control
  plane including the request log. 16 unit tests, `node --test images/mollie-mock/test/`.
- **Network interception works end to end.** From inside the shop container,
  `https://api.mollie.com/v2/methods/all` resolves to the mock and validates — *including*
  through the CA bundle the module pins (D-014). That was the biggest risk in the phase and it is
  retired; the verification command is in the "daily loop" section below.
- Shared suites `checkout-matrix`, `back-office-verify`, `refund`, `bo-order-management`, plus a
  reworked `install` and the `moduleInstalled` fixture.
- `pilots/mollie/` — the complete §5.1 consumer file set, as a drop-in for the module repo.
- Sandbox overlay with a cloudflared quick tunnel and the CLI's two-phase boot.

**Green as of this handoff, mock mode, both platform versions:**

| | result |
|---|---|
| PS 8 | `31 passed, 3 skipped, 0 failed` (3.6m) |
| PS 9 | `31 passed, 3 skipped, 0 failed` (13.2m) |

The whole suite: install, configure, the 12-cell checkout matrix, back-office verification,
refunds, all six back-office order-management scenarios, and the custom specs. **No
version-specific code** — PS 9 needed no changes once PS 8 was green, which is the adapter's
whole premise holding up.

```bash
node ../../packages/core/bin/e2e-kit.js test
```

`git status` and `git diff` in the module clone are both empty afterwards — the Phase 3 DoD's
"module source unmodified" bullet.

**The 3 skips are honest gaps, not padding:**

- two `test.fixme`s covering the module's own admin screens
  (`AdminMollieAdvancedSettings`, `AdminMolliePaymentMethods`). Both render the back-office chrome
  and the page heading and then nothing — no form controls — and the mock's request log shows the
  methods screen never calls `/v2/methods/all` at all. The committed admin bundles under
  `views/js/admin/` do load, so it is not a missing build step. Each `fixme` carries the next
  thing to try. This is the one module path the pilot does not exercise: `MolliePsp.setup` seeds
  `mol_payment_method` by SQL, so nothing else drives the module's own route to those rows.
- one `test.skip` for partial refunds in sandbox mode, which is deliberate (spec §6.3).

**Not yet done:** PS 9 has not been run to completion, and sandbox mode has not been run —
`MOLLIE_TEST_API_KEY` is now on the machine (git-ignored, `pilots/mollie/.e2e-kit/secrets.env`)
but the matrix needs a sandbox-aware path first: `MolliePsp` cannot resolve an attempt key from
the real Mollie checkout URL, and outcomes that create no order have no `platformCartId` to scope
the assertion to. Sandbox should probably start with the `paid` outcome only.

**Two coverage gaps that are decisions, not bugs** — both recorded, both worth a second opinion:
the card method runs with Mollie Components disabled (NOTES.md §12, otherwise the run depends on
`js.mollie.com` and cannot complete a submit), and `testOrder.createOrder` misses §6.3a's <5s
target because it drives the browser (D-018).

**Still carried over to Phase 2:** the DoD bullet "Mollie repo PRs blocked/green on mock matrix"
needs the reusable workflow *and* a branch in the module repo, which the no-touch instruction
rules out for now (D-016).

### Phase 2 — CI (spec §8)

Nothing blocking. Needs the `invertus` GitHub org for GHCR and the `@invertus` npm scope —
the repo owner has not yet confirmed push access, so ask before anything publishes.
`e2e-reusable.yml` should call the same `e2e-kit up/test/down` commands the CLI exposes;
that identity is the whole point of the CLI (Goal 7).

### Phase 4 — healing

`healingReporter` currently throws if `enabled: true`, by design. `E2E_HEAL_OVERRIDES` is
already consumed by `BasePage.locate`, so candidate validation (spec §9.4) has its hook.
Override values are **Playwright selector strings**, not JavaScript — deliberately, so the
harness never evals model output.

**Three corrections to spec §9.3, verified against current Anthropic API documentation on 2026-08-07.**
Recorded here so Phase 4 does not rediscover them:

1. **`temperature: 0` will not work on any current model.** Sampling parameters were removed from
   Opus 4.7 onward and are rejected on Sonnet 5 — sending `temperature` returns a 400. It is still
   accepted on the `claude-sonnet-4-6` the spec names, so the spec is not wrong *today*, but the field
   must be deleted the moment the model is bumped.
2. **The spec's manual JSON-schema validation is now partly redundant.** Structured outputs
   (`output_config.format` with a JSON schema) *guarantee* schema-valid output rather than validating
   after the fact. They are **not** available on Sonnet 4.6, so pinning that model means keeping the
   manual validation. The dynamic-id rejection (`/\d{4,}/`) stays either way — it is a semantic check no
   schema can express.
3. **`claude-sonnet-4-6` is a generation behind.** Sonnet-tier is the right choice for a mechanical
   DOM-repair call, but `claude-sonnet-5` is current, supports structured outputs, and would let the
   call run at `effort: low`.

The healing design itself needs no rethink: it is one constrained API call per failed selector, whose
output is only ever accepted after the **entire** failed spec re-runs green with the candidate injected.
The run stays red and a human merges the PR.

## Working agreement with the repo owner

Proceed phase by phase, and **stop for approval at the end of each phase** — do not roll
into the next one. Report what was actually run and what was skipped.
