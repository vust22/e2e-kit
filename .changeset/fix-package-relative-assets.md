---
'@invertus/e2e-core': patch
'@invertus/e2e-prestashop': patch
---

Ship the compose files inside `@invertus/e2e-core` and resolve them from the package root, so
`e2e-kit up` works in a consumer repository. See DECISIONS.md D-033.
