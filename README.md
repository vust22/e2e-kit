# e2e-kit

Central E2E testing kit for PrestaShop modules and shops.

A module repository adopts full E2E coverage by adding **two files** — a workflow stub and
`e2e/e2e.config.ts` — plus its own specs. Everything reusable (fixtures, page objects,
shared flows, the seeded shop images, the CI workflow) lives here.

The authoritative design is `e2e-platform-spec.md` v1.1.0-draft. Deviations from it are
recorded in [`DECISIONS.md`](./DECISIONS.md). Authoring conventions are in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Status

**Phase 1 of 5 is complete and green locally.** Phase 1 is the kit skeleton, the packages,
the seeded platform images, the compose stack and the CLI.

| Phase | Scope | State |
|---|---|---|
| 1 | Kit skeleton, packages, seeded PS 8/9 images, compose, CLI | ✅ done — 8/8 green on PS 8 and PS 9 |
| 2 | Reusable GitHub workflow, gh-pages reporting, onboarding doc | not started |
| 3 | Mollie pilot: mock server, `MolliePsp`, checkout matrix, BO suite, sandbox | not started |
| 4 | Self-healing harness | export surface only (inert) |
| 5 | Second module onboarding | not started |

Nothing publishes yet: images build to local tags (`e2e-ps:8`), packages are file-linked
through npm workspaces, and `.github/workflows/` is deliberately empty until Phase 2
(DECISIONS.md D-006).

## Requirements

- Node 22 (`.nvmrc`)
- Docker with ~4 GB available to the daemon
- On Apple Silicon: images are built and run as `linux/amd64` under emulation, matching CI
  byte-for-byte (DECISIONS.md D-003)

## Quick start

```bash
nvm use
npm install
npm run build

# Build the seeded PrestaShop 8 image (~2 min; ~5 min on Apple Silicon)
node scripts/build-image.mjs --ps 8

cd examples/consumer-module
node ../../packages/core/bin/e2e-kit.js up --ps 8 --mode mock
node ../../packages/core/bin/e2e-kit.js test
node ../../packages/core/bin/e2e-kit.js down
```

The shop comes up at <http://localhost:8080>, back office at `/admin-e2e`
(`e2e.admin@invertus.test` / `E2E_Admin_123!`).

## CLI

| Command | Purpose |
|---|---|
| `e2e-kit up [--ps 8] [--mode mock\|sandbox] [--port 8080]` | boot the compose stack |
| `e2e-kit test [--grep ...] [--shard 1/2] [--headed]` | run Playwright against it |
| `e2e-kit down` | tear the stack down |
| `e2e-kit reset-db` | fast reset to the baked seed state |
| `e2e-kit build-image [--ps 8\|--all]` | build seeded platform images |
| `e2e-kit doctor` | check the local environment |

CI calls these same commands — that is what keeps a laptop and a runner on one code path.

## Layout

```
packages/core/         @invertus/e2e-core       fixtures, config schema, PSP contract, healing
packages/prestashop/   @invertus/e2e-prestashop page objects, flows, seed dataset, adapter
images/prestashop/     seeded PS image: Dockerfile, PHP seeder, boot helpers
compose/               base stack + mock / sandbox overlays
examples/consumer-module/  a real (tiny) module exercising the shared flows
scripts/               image build, E2E CA generation
```

## How the pieces fit

- **Seed dataset** — declared once in `packages/prestashop/src/seed/dataset.ts`, compiled to
  a JSON manifest, applied at image build by a PHP seeder that uses PrestaShop's own object
  model. The seeder asserts that every entity's id matches what the dataset promises, so
  `SEED.products.TSHIRT.id === 1` is verified at build time (DECISIONS.md D-011).
- **PSP contract** — payment providers integrate through one interface
  (`@invertus/e2e-core/psp`). The kit contains no provider code; each module repo
  implements the contract for its own provider.
- **Platform adapter** — core never imports PrestaShop. `platform.type` resolves an adapter
  package at runtime, which is the seam a Shopware or WooCommerce adapter plugs into.

## Development

```bash
npm run typecheck
npm run lint
node scripts/build-image.mjs --all
```
