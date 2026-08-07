---
'@invertus/e2e-core': patch
'@invertus/e2e-prestashop': patch
---

Fix `prepare-module` for the default `module.source: '.'`. The module tree is now copied entry by
entry, so the build directory being inside the source no longer trips Node's "cannot copy to a
subdirectory of self" check. See DECISIONS.md D-031.
