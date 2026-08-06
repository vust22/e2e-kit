import { overrideFor, type Locator, type Page } from '@invertus/e2e-core';

/**
 * Common behaviour for every page object.
 *
 * The only non-obvious part is {@link BasePage.locate}: it wires the healing harness's
 * locator-override map (spec §9.4) into locator construction, so a candidate fix can be
 * validated by re-running the spec with `E2E_HEAL_OVERRIDES` set — no source edit, no
 * separate code path in normal runs.
 *
 * An override value is a **Playwright selector string** (`role=button[name="Pay"]`,
 * `css=.foo`, `internal:testid=[data-testid="e2e-x"]`), not a JavaScript expression.
 * That keeps the harness free of `eval` on model output.
 */
export abstract class BasePage {
  readonly page: Page;

  protected constructor(page: Page) {
    this.page = page;
  }

  /**
   * Build a named locator, honouring a healing override for `<ClassName>.<name>`.
   * Every locator field on a page object should go through this.
   */
  protected locate(name: string, build: () => Locator): Locator {
    const override = overrideFor(this.constructor.name, name);
    return override ? this.page.locator(override) : build();
  }

  /** Absolute URL for a shop-relative path, using the page's configured baseURL. */
  protected url(pathAndQuery: string): string {
    return pathAndQuery;
  }
}
