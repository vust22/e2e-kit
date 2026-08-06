# Contributing to `e2e-kit`

This file mirrors §7 of the technical specification. Where they disagree, the spec wins
and this file is a bug.

## 1. Locator preference order

Use the first option that works. Going further down the list requires justification.

1. `getByRole` with an accessible name — `page.getByRole('button', { name: /place order/i })`
2. `getByLabel` / `getByPlaceholder`
3. `getByTestId` — `data-testid` values are named `e2e-<area>-<element>`, kebab-case
   (e.g. `e2e-checkout-pay-button`). When a locator heals repeatedly (§9.6), the durable
   fix is adding a `data-testid` to the module or theme template — we own those codebases.
4. Stable framework ids — PrestaShop's own ids, e.g. `#checkout-personal-information-step`
5. CSS / XPath structural selectors — **last resort**, and must carry a `// FRAGILE:`
   comment explaining why nothing better exists.

### Banned

- Text-only selectors on translatable strings without a regex or i18n handling.
- `.nth()` without a `// FRAGILE:` justification.
- Chained CSS deeper than 3 levels.

## 2. The `intent:` comment is mandatory

Every public method on a page object carries a one-line intent comment:

```ts
/** intent: accept terms and submit the order, landing on either PSP redirect or confirmation */
async placeOrder(): Promise<void> { ... }
```

The self-healing harness sends this comment to the model as the only description of what
the locator was *for* (§9.3). A missing or vague intent comment degrades healing quality
and fails lint.

Write intents as **user-visible outcomes**, not implementation:

- Good: `intent: select the payment option whose module name matches`
- Bad: `intent: click the radio input`

## 3. Spec structure

- One behavior per test.
- `test.describe` per feature area.
- No shared mutable state between tests.
- Every test must pass in isolation (`--grep` on that single test) **and** under
  `--fully-parallel`.
- Setup happens through fixtures and the `testOrder` factory only — never by depending on
  a previous test's side effects.

## 4. Waits

`page.waitForTimeout` is lint-banned. Use:

- auto-waiting assertions — `await expect(locator).toBeVisible()`
- `page.waitForURL(...)`
- `expect.poll(...)` for eventual consistency (webhook processing, order state changes)

## 5. Data isolation

Each test creates its own cart/order via the `testOrder` fixture. Order references are
captured from the confirmation page and passed explicitly to verification flows.

The database is **not** reset between tests within a run (too slow). It **is** fresh per
CI job, because the container is ephemeral. Locally, run `npx e2e-kit reset-db` when state
gets dirty.

## 6. Where code goes

| Kind of code | Goes in |
|---|---|
| Reusable mechanics: fixtures, page objects, flows, webhook helpers, workflow | the kit |
| Provider-specific test logic (`PspContract` impl) | the consumer repo |
| Provider mock **services** | the kit, under `images/<provider>-mock/` (see spec §6.4) |
| Module-specific specs | the consumer repo |

If a flow is missing, **add it to the kit** — do not reimplement it locally
(Design principle 2).

## 7. Before you push

```bash
npm run typecheck
npm run lint
npm run test:unit
npx e2e-kit up --ps 8 && npx e2e-kit test && npx e2e-kit down
```
