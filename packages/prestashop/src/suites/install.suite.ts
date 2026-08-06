import path from 'node:path';
import { expect, test } from '../test.js';
import { installModule } from '../flows/installModule.js';

/**
 * Shared suite `install` (spec §5.3).
 *
 * Asserts the one thing every consumer module must do before anything else is meaningful:
 * it can be placed into a stock shop and installed cleanly from the console.
 */
/**
 * Both tests below need an installed module, and spec §7.2 requires each to pass in
 * isolation — so neither may depend on the other having run. Installation is therefore
 * idempotent in both, rather than ordered between them.
 */
export function registerInstallSuite(): void {
  test.describe('shared: install', () => {
    // Installing the same module from two workers at once is a race the shop does not
    // defend against; the suite that owns installation runs serially.
    test.describe.configure({ mode: 'serial' });

    test('the module installs into a stock shop and reports itself active', async ({
      shopCli,
      e2eConfig,
    }) => {
      const moduleName = e2eConfig.module.name;
      const sourceDir = path.resolve(process.cwd(), e2eConfig.module.source);

      if (!(await shopCli.moduleIsActive(moduleName))) {
        await installModule(shopCli, { name: moduleName, sourceDir });
      }

      expect(
        await shopCli.moduleIsActive(moduleName),
        `Module '${moduleName}' is not active after installation`,
      ).toBe(true);
    });

    test('the module appears in the back-office module manager', async ({
      admin,
      shopCli,
      e2eConfig,
    }) => {
      const moduleName = e2eConfig.module.name;
      if (!(await shopCli.moduleIsActive(moduleName))) {
        await installModule(shopCli, {
          name: moduleName,
          sourceDir: path.resolve(process.cwd(), e2eConfig.module.source),
        });
      }

      const modules = await admin.goToModules();
      expect(
        await modules.isListed(e2eConfig.module.name),
        `Module '${e2eConfig.module.name}' is missing from the module manager`,
      ).toBe(true);
    });
  });
}
