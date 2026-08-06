import { expect, test } from '../test.js';

/**
 * Shared suite `configure` (spec §5.3).
 *
 * Checks that the module's configuration screen is reachable and renders a form. What the
 * fields mean is the consumer's knowledge, so anything beyond "it opens and saves" belongs
 * in the consumer's own specs via the `configureModule` flow.
 */
export function registerConfigureSuite(): void {
  test.describe('shared: configure', () => {
    test('the module configuration page opens and renders a form', async ({
      admin,
      e2eConfig,
    }) => {
      const page = await admin.goToModuleConfig(e2eConfig.module.name);
      await expect(
        page.form,
        `Module '${e2eConfig.module.name}' did not render a configuration form`,
      ).toBeVisible();
      await expect(admin.page.locator('.alert-danger')).toHaveCount(0);
    });
  });
}
