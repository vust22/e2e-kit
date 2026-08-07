---
'@invertus/e2e-core': patch
'@invertus/e2e-prestashop': patch
---

Also mark the consumer's `e2e/` directory as ESM, so the config, PSP implementation and specs load in a
CommonJS repository. See DECISIONS.md D-034.
