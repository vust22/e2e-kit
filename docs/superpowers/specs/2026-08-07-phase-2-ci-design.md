# Phase 2 — CI, publishing and the consumer adoption path

**Status:** approved; implementation authorized for local work and `vust22/e2e-kit` only
**Date:** 2026-08-07
**Authorization boundary (2026-08-07):** the repo owner approved autonomous implementation "as long as
we work locally or under `@vust22`", with **nothing pushed to the Mollie or invertus repos**. That
includes `vust22/mollie` — the fork. §6 is therefore prepared locally and left unpushed; see §8 for the
substituted proof and §9 for what this defers.
**Spec ref:** `/Users/justas/Downloads/e2e-platform-spec.md` §8 (CI design), §10 (versioning and
release), §11 (secrets), §12 Phase 2 DoD
**Supersedes:** DECISIONS.md D-006 ("Phase 1 is local-only: no GHCR pushes, no npm publishing, no
GitHub workflows")

---

## 1. What Phase 2 delivers

Phase 1 proved the stack green on a laptop. Phase 3 proved the Mollie pilot green on both platform
versions. Neither has ever run anywhere but this machine: `.github/` does not exist, nothing is
published, and the consumer workflow stub in `pilots/mollie/.github/workflows/e2e.yml` points at a
reusable workflow that has not been written.

Phase 2 closes that gap:

- `e2e-reusable.yml` — the full §8.1 job graph, healing job stubbed
- `images.yml` — seeded PrestaShop + Mollie mock images published to GHCR as matched sets
- `release.yml` — changesets-driven versioning and package publishing (D-002's deferred half)
- `kit-ci.yml` — the kit's own CI, so a kit PR cannot merge a change that breaks its own flows
- `docs/ONBOARDING.md` and a consumer Renovate template
- The Mollie fork adopted through the real path, as the phase's proof

The dry run happens on the repo owner's personal GitHub account (`vust22`) before anything touches
the `invertus` org.

## 2. Decisions taken up front

| Question | Decision |
|---|---|
| What must the dry run prove? | **Full adoption-path rehearsal.** `vust22/e2e-kit` publishes packages and images for real; `vust22/mollie` consumes them through the 2-file stub. Moving to `invertus` later is a namespace + secrets change, nothing structural. This is what §12's Phase 2 DoD asks for, and the only version that also closes Phase 3's carried-over "Mollie repo PRs blocked/green on mock matrix" bullet. |
| How does the overlay reach the Mollie fork? | **Fresh clone of the fork.** `/Users/justas/e2e-playbook/mollie-module` stays untouched and read-only. The fork is cloned to a new path and `pilots/mollie/{e2e,.github}` is copied in verbatim — the copy itself is the proof that D-016's "drop-in" claim holds. |
| Kit repo visibility | **Public.** Removes four obstacles at once: Pages availability on the Free plan, reusable-workflow access grants, GHCR pulls with the plain `GITHUB_TOKEN`, and the 2000-minute private-repo Actions quota. |
| Package distribution | **GitHub Packages under `@vust22/*`, consumed through an npm alias.** Chosen because spec §11's secrets table budgets for `GHCR` access via `GITHUB_TOKEN` and lists **no** `NPM_TOKEN` — the design already assumed GitHub Packages. Costs an `.npmrc` in CI and a `read:packages` PAT for local installs. |
| Run reporting | **Downloadable zip artifacts, not gh-pages** (deviation from §8.1 — see D-023). |

## 3. Prerequisites

### 3.1 Commit the Phase 3 work

38 files are uncommitted. They land as three reviewable commits, because this history is what
eventually gets pushed to the real org:

1. `feat(mock): Mollie /v2 mock image with TLS interception and control plane` — `images/mollie-mock/**`
   and its 16 unit tests
2. `feat(suites): checkout-matrix, back-office-verify, refund and BO order management` — the four new
   shared suites, `PspContract` capability additions, the run-once guard, module build + CA patching,
   the tunnel helper, and the page-object fixes those required
3. `feat(pilot): Mollie consumer overlay, decisions D-014…D-019, handoff` — `pilots/**`,
   `DECISIONS.md`, `docs/HANDOFF.md`

`.e2e-kit/` is already gitignored, so the full module copy under
`pilots/mollie/.e2e-kit/module-build/` is not committed.

### 3.2 Remote, visibility, tokens

`vust22/e2e-kit` has no default branch yet, so the first push of `main` establishes it. Then flip the
repo public.

The active `vust22` token carries `repo, read:org, gist, admin:public_key` — it lacks `workflow`,
`write:packages` and `read:packages`. Pushing workflow files over SSH works without them, but
`gh workflow run` and any package operation does not. **The repo owner runs this themselves:**

```bash
gh auth refresh -h github.com -s workflow,write:packages,read:packages
```

### 3.3 No Pages anywhere

Reports are zip artifacts (§5.4), so neither repo needs Pages enabled and the reusable workflow needs
no `contents: write` on the caller.

## 4. Workflows

### 4.1 `images.yml` — the matched image set

**One job, not a per-image matrix.** D-009 generates the E2E CA per build and the mock's
`api.mollie.com` leaf is signed by that same CA, so a PrestaShop image and a Mollie mock image built
in separate jobs would carry different CAs and TLS interception would fail with an unknown-issuer
error. The CA, all three images, and the push must happen in one invocation.

Triggers: pushes to `main` touching `images/**` or `packages/prestashop/src/seed/**`, plus
`workflow_dispatch`. Steps: Node 22 → `npm ci` → `tsc --build` (the seed manifest is generated from
`dataset.ts`, so the adapter must compile first) → `gen-ca` → build → push.

Every image in a build shares one tag suffix, which is what enforces the pairing:

```
ghcr.io/vust22/e2e-ps:8-<sha7>          ghcr.io/vust22/e2e-ps:8-main      (moving alias)
ghcr.io/vust22/e2e-ps:9-<sha7>          ghcr.io/vust22/e2e-ps:9-main
ghcr.io/vust22/e2e-mock-mollie:<sha7>   ghcr.io/vust22/e2e-mock-mollie:main
```

`e2e-reusable.yml` takes a single `image-set` input (default `main`) and derives all three refs from
it, so a shop image can never be paired with a mock from a different CA. Pinning an immutable set is
`image-set: <sha7>`.

**No kit code changes are needed for this.** `E2E_PS_IMAGE` and `E2E_MOLLIE_MOCK_IMAGE` are already
env-overridable (`packages/core/bin/e2e-kit.js:116`, `compose/docker-compose.mock.yml:25`), and
`platform.imageOverride` already exists in the config schema.

Builds run natively on amd64 on `ubuntu-latest` — no emulation, unlike the laptop (D-003).

### 4.2 `release.yml` — changesets, and a publish-time scope remap

D-002 already chose changesets; the `.changeset/` directory was deferred to this phase and lands
here. Push to `main` → the changesets action maintains a "Version Packages" PR → merging it publishes,
tags, and moves the floating `v1` tag that consumers pin with `@v1` (§10).

**The wrinkle.** GitHub Packages requires the npm scope to match the repository owner, so packages
must publish as `@vust22/*`. But 51 files import `@invertus/e2e-core` or `@invertus/e2e-prestashop`,
and renaming the `name` fields would break every one of them locally — the workspace symlink they
resolve through is keyed on the package name.

So the remap happens **at publish time, not in the repo**. `scripts/prepare-publish.mjs` stages each
package into a temp directory and rewrites exactly two things in the copied `package.json`:

```jsonc
// packages/prestashop/package.json — in the repo, unchanged:
{ "name": "@invertus/e2e-prestashop",
  "dependencies": { "@invertus/e2e-core": "0.1.0" } }

// what is actually published:
{ "name": "@vust22/e2e-prestashop",
  "dependencies": { "@invertus/e2e-core": "npm:@vust22/e2e-core@0.1.0" } }
```

The rewritten dependency line is load-bearing. The compiled `dist` still contains
`import '@invertus/e2e-core'`, so the published package must declare a dependency that *installs to
that path* — the alias does exactly that. Without it the published adapter resolves nothing.

Net effect: zero source churn, zero local breakage, and the eventual move to `invertus` is deleting
one script. Consumers add one alias devDep per package they import directly.

### 4.3 `kit-ci.yml` — the kit cannot break its own flows

Spec §10. On every kit PR:

1. `lint + typecheck + unit` — fast; includes the mock's 16 `node --test` cases
2. `e2e` matrix over PS 8 and PS 9, running `examples/consumer-module`

It **builds images from the PR's source** rather than pulling published ones: a PR touching
`images/**` has to be tested as changed. The example module declares no `psp`, so the preset gives it
`workers: 2` (`packages/core/src/reporting/preset.ts:39`).

### 4.4 `e2e-reusable.yml` — the §8.1 job graph

```
prepare ─ validate config, emit matrix JSON, detect sandbox eligibility
   ├─ e2e-mock      [ps-8, ps-9] × [shard 1..N]   BLOCKING on PRs
   ├─ e2e-sandbox   [ps-8, ps-9]                  main + nightly only, never blocking
   ├─ report        always()  → merge blobs, zip, PR comment
   └─ heal          stubbed — job exists, echoes "Phase 4", never runs
```

Inputs: `config-path` (required) and `image-set` (default `main`). `secrets: inherit`. Permissions:
`pull-requests: write` for the comment; no `contents: write`. There is deliberately no `kit-ref`
input — the kit arrives as published packages plus a published image set, which is the whole point of
the full-rehearsal choice.

**`prepare`** needs the only new *runtime* code in this phase: an `e2e-kit ci-matrix` subcommand that
loads `e2e.config.ts` through the existing zod schema and prints the matrix as JSON. This keeps the
matrix derived from the config rather than duplicated in YAML. (The other new code is build-time:
`scripts/prepare-publish.mjs` and the `.changeset/` configuration.)

**`e2e-mock`** writes the GitHub Packages `.npmrc` itself, so consumers still add only their two
files — the auth plumbing stays inside the kit. It then runs the same CLI commands the local daily
loop uses (`prepare-module` → `up --ps N --mode mock` → `test --shard i/N`), which is the local/CI
parity Goal 7 exists for, and uploads the blob report plus container logs.

Per §11, mock jobs are passed **no provider secrets at all** — enforced structurally by the workflow
only forwarding `psp.sandbox.requiredSecrets` into sandbox jobs.

**`e2e-sandbox`** runs only when `psp.sandbox.enabled` and the event is `schedule` or a push to
`main` (§8.3: sandbox posts status but never blocks PRs). A missing required secret skips the job with
an annotation rather than failing red.

**Sharding is how parallelism is recovered.** A PSP-bearing config runs `workers: 1` — concurrent
module installs and concurrent `cache:clear` both fail outright (D-019, and Phase 1 finding 3). The
Mollie config sets `ci.shards: 2`, so wall-clock comes from sharding across jobs, not workers within
one.

### 4.5 Consumer stub

`pilots/mollie/.github/workflows/e2e.yml` changes `invertus/e2e-kit` → `vust22/e2e-kit`, keeping
`@v1`. Everything else in the file already matches §5.2.

## 5. Reporting

### 5.1 Zip artifacts, not gh-pages

§8.1 says "publish HTML to gh-pages `/e2e/<run-id>/`". This design ships **zip artifacts** instead
(D-023). Reasons:

- The reusable workflow runs under the *consumer's* `GITHUB_TOKEN`, so it could only ever write to the
  consumer's gh-pages — and the Mollie consumer is a fork of someone else's public repo, where
  pushing a `gh-pages` branch is invasive.
- Artifacts behave identically on private repos and the Free plan, so nothing about the report path
  changes when this moves to the `invertus` org. Pages does not.
- Permissions shrink to `pull-requests: write`.

Costs, stated plainly: a Playwright HTML report cannot be opened from `file://` — the reviewer
downloads, unzips, and runs `npx playwright show-report <dir>`. Compensated by putting the full
summary table **inline in the PR comment**, so ordinary triage needs no download; only trace-level
debugging does. And artifacts expire at 30 days (§8.2's own retention figure), so there is no
long-term report history. Nothing in Phases 2–3 depends on that; §9.6's healing telemetry uses
separate JSON-line artifacts.

### 5.2 Zip contents

One zip per mode, produced by `report` after downloading every shard's blob report:

```
e2e-report-mock-<run_id>.zip
├── index.html + data/      merged report: all shards AND both PS versions in one view
├── summary.json            per-project counts — the source for the PR comment
├── junit.xml               for external tooling
└── logs/
    ├── ps8-shard1-shop.log  docker compose logs, captured on failure
    └── ps8-shard1-db.log    — what diagnoses ENV_BOOT_FAILED
```

Shards merge cleanly across platform versions because each carries its own Playwright project name
(`chromium-ps8` / `chromium-ps9`, from `preset.ts`).

**Two zips, `mock` and `sandbox`, not one merged view.** The project name encodes the platform version
but not the mode, so a `chromium-ps8` shard from a mock run and from a sandbox run would be
indistinguishable in a single merged report. Keeping them apart avoids a preset change and mirrors
§8.3's blocking/non-blocking split.

### 5.3 Boot budget semantics

§8.2 says exceeding the 90s boot budget should "fail fast with `ENV_BOOT_FAILED`". Read literally that
fails an otherwise-green run because boot took 95s. The annotation's actual purpose is to stop healing
from firing on environment problems, so this design emits `ENV_BOOT_FAILED` on a genuine boot failure
or timeout, and a **non-fatal warning** when merely over budget (D-024).

## 6. Mollie fork adoption — prepared, not pushed

> **Not executed autonomously.** The 2026-08-07 authorization boundary excludes `vust22/mollie`. The
> steps below are carried out up to and including the local commit; the `git push` and the PR wait for
> the repo owner. The clone is a read-only-remote checkout — no push remote is configured, so the push
> cannot happen by accident.

```bash
git clone git@github.com:vust22/mollie.git /Users/justas/e2e-playbook/mollie-fork
cd /Users/justas/e2e-playbook/mollie-fork
git remote set-url --push origin DISABLED   # guard: make an accidental push fail
git switch -c e2e-kit-adoption              # off master
cp -r <kit>/pilots/mollie/e2e <kit>/pilots/mollie/.github .
```

**Version risk is retired:** the fork's `master` is at `503b96c0`, the exact commit the read-only
clone sits on (v6.4.4). Everything `pilots/mollie/e2e/NOTES.md` and the page objects were verified
against holds on the fork with no drift.

Two edits follow the copy, both expected:

- `.github/workflows/e2e.yml`: `invertus/e2e-kit@v1` → `vust22/e2e-kit@v1`
- the fork's existing `package.json`: add the two alias devDeps

`e2e/e2e.config.ts` needs **no change** — its `source: '.'` was always correct inside a real module
repo, and `MOLLIE_MODULE_SOURCE` stops being needed. That variable existing only to work around the
read-only clone is precisely what D-016 predicted would disappear here.

The remaining steps — push the branch, open a PR from `e2e-kit-adoption` → `master` **on the fork**,
and let `e2e.yml` fire — are the repo owner's to run. `pilots/mollie/` stays in the kit as the
reference copy. **D-016 stays open** until that PR runs green; it is amended to record that the fork
is green-lit and the overlay is staged, not that it is resolved.

**Sequencing:** the stub pins `@v1`, which does not resolve until a release exists. `release.yml` must
publish `v0.1.0` and move the floating `v1` tag *before* the fork PR opens.

## 7. Docs and decisions

`docs/ONBOARDING.md`, written from §5: the 2-file adoption, the `e2e.config.ts` reference, the local
CLI loop, §8.3 branch protection, how to read a report zip, and the one genuine papercut — **local
installs need a `read:packages` PAT**, because GitHub Packages authenticates even public reads. CI does
not, because the workflow writes its own `.npmrc`.

A consumer `renovate.json` template. Flagged honestly: §10 wants `@invertus/e2e-*` grouped, but
consumers declare those as `npm:` aliases, and Renovate's alias support will be verified against its
docs rather than assumed — and documented if it does not hold.

New `DECISIONS.md` entries:

| Entry | Subject |
|---|---|
| D-023 | Run reports are downloadable zip artifacts, not gh-pages |
| D-024 | `ENV_BOOT_FAILED` on genuine boot failure; over-budget boot warns, does not fail |
| D-025 | The `vust22` dry-run namespace and the publish-time scope remap |
| D-026 | Images publish as matched sets sharing a tag suffix (the D-009 CA constraint) |
| D-006 | amended: superseded by this phase |
| D-016 | amended: the fork is green-lit and the overlay is staged locally; stays open until the fork PR runs green |
| D-027 | The reusable workflow is proven by an in-kit caller, because the consumer-repo proof is out of the authorization boundary |

## 8. Verification — what closes the phase

1. Kit repo public and pushed; `images.yml` green; a matched set visible in GHCR
2. `release.yml` publishes `@vust22/e2e-core` and `@vust22/e2e-prestashop`; `v1` tag moved
3. `kit-ci.yml` green on a kit PR — example module, PS 8 and PS 9
4. **`e2e-selftest.yml` green** — a workflow in the kit repo that *calls* `e2e-reusable.yml` with
   `config-path: examples/consumer-module/e2e/e2e.config.ts`. This is a genuine cross-workflow
   `uses:` invocation exercising the real job graph, matrix expansion, `.npmrc` write, published image
   pull, blob merge, zip and PR comment — everything a consumer repo would exercise except living in a
   different repository (D-027)
5. Report zip downloads and opens under `show-report`; PR comment carries the inline summary
6. `docs/ONBOARDING.md` documents the §8.3 branch-protection setup (not applied — it belongs on the
   consumer repo)

**Deferred to the repo owner, blocked on authorization, not on work:**

- Fork PR fires `e2e.yml`; `e2e-mock` green on both versions, **matching the local
  `31 passed / 3 skipped` exactly** — any divergence is a real finding, not noise
- Branch protection on the fork requiring `e2e-mock (ps-8)` and `e2e-mock (ps-9)`

**On the spec's stated DoD.** §12 asks for `examples/consumer-module` adopted "in a scratch repo". Two
substitutions apply, and both are weaker than the original:

1. The example module lives inside the kit, so "in a scratch repo" would need a third repository.
   `e2e-selftest.yml` proves the reusable workflow works when *called from a caller workflow*, which is
   the mechanism the scratch repo was there to test — but it does not prove it works *across a
   repository boundary*, where the token, the package read, and the image pull are all cross-repo.
2. The Mollie fork PR — the strongest available evidence, and a real module repo — is out of the
   authorization boundary.

**Phase 2 therefore cannot be declared DoD-complete on this pass.** Items 1–6 are achievable; the
cross-repo proof is not. That is stated plainly rather than papered over, and it is the first thing the
repo owner should close.

## 9. Explicitly out of scope

- **The first green nightly sandbox run.** The sandbox job and the `MOLLIE_TEST_API_KEY` secret are
  wired, non-blocking per §8.3. But sandbox in CI needs the cloudflared tunnel *and* the sandbox-aware
  matrix path the Phase 3 handoff already lists as unbuilt (`MolliePsp` cannot resolve an attempt key
  from a real Mollie checkout URL, and outcomes that create no order have no `platformCartId` to scope
  assertions to). Phase 2 delivers the job, not a green run through it. Phase 3 closeout item.
- **Healing.** The `heal` job is a stub that echoes and exits, exactly as §12 specifies.
  `healingReporter` continues to throw if `enabled: true`.
- **Anything under the `invertus` org.** No GHCR pushes, no npm publishing, no repo creation there
  until the owner confirms push access (§12 Phase 2 note).
- **Any push to `vust22/mollie`.** The overlay branch is committed locally with its push remote
  disabled (§6). Pushing it and opening the PR is the owner's call.
- **Branch protection.** Requires the fork PR to exist first, and belongs to the consumer repo
  regardless. Documented in ONBOARDING.md, not applied.

## 10. Notes carried to Phase 4

Verified against current Anthropic API documentation while answering a question about §9, recorded
here so Phase 4 does not rediscover it:

- **`temperature: 0` (§9.3) will not work on any current model.** Sampling parameters were removed
  from Opus 4.7 onward and are rejected on Sonnet 5 — the field returns a 400. It is still accepted on
  the `claude-sonnet-4-6` the spec names, so the spec is not wrong today, but the field must be
  dropped the moment the model is updated.
- **The spec's manual JSON-schema validation is now partly redundant.** Structured outputs
  (`output_config.format` with a JSON schema) guarantee schema-valid output rather than validating
  after the fact — but they are not available on Sonnet 4.6, so pinning that model means keeping the
  manual validation. The dynamic-id rejection (`/\d{4,}/`) stays either way; it is a semantic check no
  schema expresses.
- **`claude-sonnet-4-6` is a generation behind.** Sonnet-tier is right for a mechanical DOM-repair
  call, but `claude-sonnet-5` is current, supports structured outputs, and would allow `effort: low`.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Renovate may not track `npm:` alias dependencies | Verify against Renovate docs during implementation; document the limitation in ONBOARDING.md if it does not hold |
| PS 9 mock suite takes 13.2m locally | CI runs native amd64 (no emulation) and shards ×2; measure before tuning |
| GitHub Packages needs auth even for public reads | Accepted; CI writes its own `.npmrc`, local dev needs a `read:packages` PAT, documented in ONBOARDING.md |
| Publish-time scope remap is non-standard | Contained to one script whose deletion is the migration back to `@invertus`; the alias mechanics are covered by the fork PR actually installing and running |
