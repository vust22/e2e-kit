# @invertus/e2e-core

## 0.2.1

### Patch Changes

- cd3ce59: Fix `prepare-module` for the default `module.source: '.'`. The module tree is now copied entry by
  entry, so the build directory being inside the source no longer trips Node's "cannot copy to a
  subdirectory of self" check. See DECISIONS.md D-031.

## 0.2.0

### Minor Changes

- 8e881d2: First published release. Adds the CI job matrix (`e2e-kit ci-matrix`), the shared
  `checkout-matrix` / `back-office-verify` / `refund` / `bo-order-management` suites, and the
  `PspContract` capability flags.
