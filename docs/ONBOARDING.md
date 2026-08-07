# Onboarding a repository onto the E2E kit

Spec §5. Adopting the kit is **two files added and two lines added to your `package.json`**. Everything
else — booting a seeded shop, building your module, running the matrix, publishing the report — lives
in the kit's reusable workflow, so a kit release upgrades every consumer at once.

---

## 1. What you add

```
<your-module-repo>/
├── .github/workflows/e2e.yml     # file 1 — ~20 lines, calls the kit
└── e2e/
    ├── e2e.config.ts             # file 2 — declarative config
    ├── psp/YourPsp.ts            # payment modules only
    └── specs/*.spec.ts           # your own specs (optional)
```

### File 1 — `.github/workflows/e2e.yml`

```yaml
name: e2e

on:
  pull_request:
  push:
    branches: [master, main]
  schedule:
    - cron: '0 3 * * *'

# Required. GitHub defaults GITHUB_TOKEN to read-only on many repositories — always on forks — and a
# called workflow cannot exceed what its caller was granted. Omit this and the run fails at startup
# with no jobs and no logs, which is a genuinely hard failure to read (D-030).
permissions:
  contents: read
  packages: read
  pull-requests: write

jobs:
  e2e:
    uses: vust22/e2e-kit/.github/workflows/e2e-reusable.yml@v1
    with:
      config-path: e2e/e2e.config.ts
    secrets: inherit
```

If your organisation forbids elevating `GITHUB_TOKEN` beyond read-only, drop `pull-requests: write`.
The matrix still runs; you lose only the summary comment, and the report zip is unaffected.

`@v1` is a floating major tag the kit moves on each release, so you get fixes without editing this
file. Pin `@v1.2.3` if you need to freeze.

Optional input: `image-set`. It defaults to `main`, the newest published image set. Pin an immutable
set (`image-set: a1b2c3d`) to escape a bad rebuild. **All platform and mock images resolve from this
one value on purpose** — the shop image trusts a CA generated per build and the provider mock serves a
leaf signed by that same CA, so mixing suffixes fails TLS interception with an unknown-issuer error
(`DECISIONS.md` D-009, D-026).

### File 2 — `e2e/e2e.config.ts`

```ts
import { defineE2EConfig } from '@invertus/e2e-core';
import { MolliePsp } from './psp/MolliePsp.js';

export default defineE2EConfig({
  module: {
    name: 'mollie',                 // directory name under modules/
    build: 'composer install --no-dev',
    source: '.',                    // module source within the repo
    trustBundles: [],               // see "Modules that pin a CA bundle" below
  },
  platform: {
    type: 'prestashop',
    versions: ['8', '9'],           // image tags to matrix over
    imageOverride: null,
  },
  psp: {                            // omit entirely for non-payment modules
    implementation: MolliePsp,
    methodsUnderTest: ['ideal', 'creditcard', 'banktransfer'],
    outcomesUnderTest: ['paid', 'failed', 'canceled', 'expired'],
    sandbox: {
      enabled: true,
      blocking: false,              // sandbox never blocks a PR (§8.3)
      requiredSecrets: ['MOLLIE_TEST_API_KEY'],
    },
  },
  suites: {
    shared: ['install', 'configure', 'checkout-matrix', 'back-office-verify', 'refund'],
    custom: 'e2e/specs/**/*.spec.ts',
  },
  seedHook: 'e2e/seed-hook.sh',     // optional, runs in the container after install
  ci: { shards: 2, retries: 1 },
});
```

`checkout-matrix` expands to one test per `method × outcome`. That single line is where most of the
coverage comes from — three methods × four outcomes is twelve journeys, each running
checkout → hosted payment page → outcome → webhook → back-office order-state assertion.

**Two config errors the schema rejects outright**, before anything boots:

- `checkout-matrix` in `suites.shared` with no `psp` block — the suite has nothing to generate from.
- a `psp.sandbox.enabled: true` with an empty `requiredSecrets` — the sandbox job would run
  unauthenticated.

### Nothing else — and add `.e2e-kit/` to `.gitignore`

You do **not** write a `playwright.config.ts`. The kit generates one in `.e2e-kit/` from your
`e2e.config.ts`, together with a `package.json` marking that directory ESM so it loads even when your own
package is CommonJS. Add `.e2e-kit/` to your `.gitignore` — it holds the generated config, the prepared
module build tree, and run-once markers, none of which belong in git.

If you need to customise Playwright, write your own `playwright.config.ts` in the repo root calling
`definePlaywrightConfig({ config, testDir, overrides })`. The CLI prefers yours over the generated one.
**Caveat:** a hand-written config only loads if your `package.json` declares `"type": "module"` — the kit
is ESM-only and has no CommonJS entry point (DECISIONS.md D-034). If your repo is CommonJS, use the
generated config.

### The `package.json` edit

```json
{
  "devDependencies": {
    "@invertus/e2e-core": "npm:@vust22/e2e-core@^0.2.0",
    "@invertus/e2e-prestashop": "npm:@vust22/e2e-prestashop@^0.2.0"
  }
}
```

Those are **npm aliases**, and the shape is deliberate. Packages publish under `@vust22/*` because
GitHub Packages requires the scope to match the repository owner, but every import you write stays
`@invertus/...`. The alias installs the published package at the path your imports expect
(`DECISIONS.md` D-025). When the kit moves to its permanent org the aliases collapse to ordinary
dependencies and your source does not change.

---

## 2. The one papercut: a token for local installs

**GitHub Packages authenticates even public reads.** CI is fine — the reusable workflow supplies its
own token — but a developer installing locally needs a classic PAT with `read:packages`:

```bash
# ~/.npmrc
//npm.pkg.github.com/:_authToken=ghp_yourTokenHere
@vust22:registry=https://npm.pkg.github.com
```

Without it, `npm ci` fails with `401 Unauthorized` on `@vust22/e2e-core` — which reads like a missing
package rather than a missing token.

---

## 3. Modules that pin a CA bundle

Most modules need nothing here. But if your module's HTTP client sets `CURLOPT_CAINFO` — pointing at a
vendored bundle such as `Composer\CaBundle` — it overrides both `curl.cainfo` and the OS trust store,
so baking the E2E CA into the image does nothing for your traffic. List the bundle:

```ts
module: {
  trustBundles: ['vendor/composer/ca-bundle/res/cacert.pem'],
}
```

The kit appends the E2E CA to that file at build time. Symptom if it is missing: every provider call
fails after a multi-second retry storm inside your HTTP adapter, with no useful error anywhere.

---

## 4. Running it locally

CI runs these exact commands, which is what keeps a laptop and a runner on the same code path.

```bash
npx e2e-kit up --ps 8 --mode mock     # shop at http://localhost:8080, BO at /admin-e2e
npx e2e-kit test                      # add --grep, --shard, --headed, --debug
npx e2e-kit reset-db                  # fast reset between iterations
npx e2e-kit down
npx e2e-kit doctor                    # check docker, node, built images, running stack
```

Credentials: `e2e.admin@invertus.test` / `E2E_Admin_123!`

**Two gotchas that cost real time:**

1. **After `reset-db`, delete the run-once markers.** Shop-mutating setup runs once per run, tracked by
   marker files. A reset drops the module's tables but leaves the markers, so the next run believes the
   module is still installed:
   ```bash
   find .e2e-kit -maxdepth 1 -name '.once-*' -exec rm -rf {} +
   ```
2. **Never run `cache:clear` directly.** Two Playwright workers clearing the cache concurrently break
   each other, and running it as root leaves root-owned cache files that 500 the whole storefront until
   `chown -R www-data:www-data /var/www/html/var`. Go through `ShopCli.clearCache()`, which serialises
   with `flock` and uses `--env=prod`.

Watching a run in a real browser is `--headed`; `--debug` opens the Playwright Inspector to step
through actions.

---

## 5. Reading a run's report

Reports are **downloadable zip artifacts**, not a hosted page (`DECISIONS.md` D-023).

For most triage you do not need them: the PR comment carries the full per-project pass/fail/skip table
inline. When you need traces:

```bash
gh run download <run-id> --name e2e-report-mock-<run-id>
npx playwright show-report merged-report
```

`show-report` is required — a Playwright HTML report cannot be opened from `file://`. The zip also
carries `summary.json`, `junit.xml`, and, on failure, `logs/` with per-container docker logs, which is
what diagnoses an `ENV_BOOT_FAILED` annotation.

**Artifacts expire after 30 days.** There is no long-term report history; if you need to keep a run,
download it.

---

## 6. Required checks (§8.3)

Protect your default branch requiring:

- `e2e-mock (ps-8)`
- `e2e-mock (ps-9)`

Do **not** require the sandbox jobs. They talk to a real provider, are marked
`continue-on-error`, and run only on the default branch and the nightly schedule — requiring them
makes external flake block merges. A failing nightly sandbox run should open a deduplicated
`e2e-sandbox-failure` issue instead.

---

## 7. Keeping the kit up to date

Copy `docs/renovate.consumer.json` into your repo as `renovate.json`. It groups both kit packages,
automerges patches, and opens a PR for minor and major.

**Caveat, verified rather than assumed:** Renovate added npm-alias support in
[#34013](https://github.com/renovatebot/renovate/issues/34013) (closed April 2025), but it is not
documented on the npm manager page, and
[#16946](https://github.com/renovatebot/renovate/issues/16946) reports aliased packages 404ing in
Renovate Artifacts. Alias handling has **not** been exercised against this kit yet. If Renovate does
not raise kit PRs, bump the two versions manually — the aliases disappear when the kit moves to its
permanent org, and this caveat disappears with them.

---

## 8. What the kit runs for you

The reusable workflow's job graph (spec §8.1):

```
prepare        parse your config, compute the matrix
├─ e2e-mock    platform-version × shard   — BLOCKING on PRs, zero provider secrets present
├─ e2e-sandbox platform-version           — default branch + nightly only, never blocking
├─ report      merge shard reports, upload the zip, comment on the PR
└─ heal        Phase 4; a stub today
```

Mock jobs receive **no provider credentials at all**. Only sandbox jobs are passed the secrets your
config names in `psp.sandbox.requiredSecrets` (spec §11). That split is structural in the workflow, not
a runtime check.
