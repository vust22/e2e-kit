---
'@invertus/e2e-core': patch
'@invertus/e2e-prestashop': patch
---

Resolve the E2E CA from the platform image when the kit's source tree is not present, so
`module.trustBundles` works in a consumer repository. See DECISIONS.md D-032.
