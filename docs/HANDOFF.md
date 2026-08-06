# Handoff

Everything a fresh session needs to pick this up. Read `README.md` first for what the kit
is; this file is only the things that are true about *this machine and this moment* and are
not derivable from the code.

Last updated: 2026-08-06, end of Phase 1.

---

## Source of truth

- **Spec:** `/Users/justas/Downloads/e2e-platform-spec.md` (v1.1.0-draft). It is the single
  source of truth; the repo implements it. Read §0 before starting a phase.
- **Deviations:** `DECISIONS.md`, entries D-001 … D-013. Add a new entry for any further
  deviation rather than silently diverging.
- **Conventions:** `CONTRIBUTING.md` (mirror of spec §7).

## State as of this handoff

**Phase 1 complete and verified green.** Phases 2–5 are untouched.

| Phase | State |
|---|---|
| 1 — kit skeleton, packages, seeded PS 8/9 images, compose, CLI | ✅ done, 8/8 green on both PS 8 and PS 9 |
| 2 — reusable workflow, gh-pages reporting, onboarding doc | not started; `.github/workflows/` is empty |
| 3 — Mollie pilot | not started |
| 4 — self-healing | export surface only; `healingReporter` **throws if enabled** |
| 5 — second module onboarding | not started |

Verified at the end of Phase 1: clean `up --ps 8 && test` in 57s (8/8), same suite green on
PS 9, three consecutive repeat runs green, `tsc --build --force` / `eslint .` / 10 unit tests
all clean, and both custom lint rules proven to fire against a probe file.

### Git

The repo is `git init`-ed on `main` with **no commits yet** — everything is untracked. The
repo owner asked not to commit without being asked. Confirm before making the first commit.

Nothing is published: images build to local tags (`e2e-ps:8`, `e2e-ps:9`), packages are
file-linked through npm workspaces, no GHCR, no npm registry (DECISIONS.md D-006).

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

`e2e-kit doctor` reports docker, node, built images and whether a stack is running.

Editing `packages/**` needs only `tsc --build` — the specs resolve the workspace packages
through symlinks, so there is no reinstall step.

## Four findings that cost real time — do not rediscover them

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

Also: PrestaShop module class names keep underscores and capitalise each segment
(`e2e_consumer` → `E2e_Consumer`); getting it wrong surfaces as a `TypeError` deep inside
`ModuleRepository`.

## What each remaining phase needs

### Phase 3 — Mollie pilot (spec §6)

**Blocked on input:** the Mollie PrestaShop module repo path or URL. The repo owner said
they would provide it.

Also worth raising before starting: spec §0 says implement in phase order, and Phase 3's DoD
includes *"Mollie repo PRs blocked/green on mock matrix"*, which needs Phase 2's reusable
workflow to exist. Everything else in Phase 3 (mock server, `MolliePsp`, checkout matrix, BO
suite, sandbox overlay) can be built and verified locally without Phase 2. If Phase 3 is
taken first, that one DoD bullet carries over to Phase 2.

Hard constraint from the spec: **the module's source is not modified in any way for
testability.** If something appears to require it, stop and record the blocker in
`DECISIONS.md` instead of changing module code. Phase 3's DoD includes an empty `git diff`
of the module source.

Foundations already in place for it: `compose/docker-compose.mock.yml` and
`docker-compose.sandbox.yml` carry the mode wiring; the E2E CA is generated per build by
`scripts/gen-ca.mjs` and already baked into the PS image trust store, and the script accepts
`--host api.mollie.com` to issue the matching leaf certificate; `SHARED_SUITE_REGISTRY`
already lists `checkout-matrix`, `back-office-verify`, `refund` and `bo-order-management` as
registrars that throw "not implemented yet (Phase 3)", so wiring them up is filling in those
four functions.

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

## Working agreement with the repo owner

Proceed phase by phase, and **stop for approval at the end of each phase** — do not roll
into the next one. Report what was actually run and what was skipped.
