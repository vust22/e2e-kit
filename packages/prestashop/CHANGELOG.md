# @invertus/e2e-prestashop

## 0.2.2

### Patch Changes

- 2d5ae0e: Resolve the E2E CA from the platform image when the kit's source tree is not present, so
  `module.trustBundles` works in a consumer repository. See DECISIONS.md D-032.
- Updated dependencies [2d5ae0e]
  - @invertus/e2e-core@0.2.2

## 0.2.1

### Patch Changes

- cd3ce59: Fix `prepare-module` for the default `module.source: '.'`. The module tree is now copied entry by
  entry, so the build directory being inside the source no longer trips Node's "cannot copy to a
  subdirectory of self" check. See DECISIONS.md D-031.
- Updated dependencies [cd3ce59]
  - @invertus/e2e-core@0.2.1

## 0.2.0

### Minor Changes

- 8e881d2: First published release. Adds the CI job matrix (`e2e-kit ci-matrix`), the shared
  `checkout-matrix` / `back-office-verify` / `refund` / `bo-order-management` suites, and the
  `PspContract` capability flags.

### Patch Changes

- Updated dependencies [8e881d2]
  - @invertus/e2e-core@0.2.0
