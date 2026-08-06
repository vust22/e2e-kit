import { test as kitTest, expect } from '@invertus/e2e-core';
import type { AdminPanel } from './facades/AdminPanel.js';
import type { Storefront } from './facades/Storefront.js';
import type { PrestaShopTestOrderFactory } from './orders/TestOrderFactory.js';
import type { PrestaShopCli } from './cli/ShopCli.js';

/**
 * `test` with the PrestaShop facades typed concretely.
 *
 * Core's `test` (spec §3.3) types `storefront`/`admin`/`testOrder`/`shopCli` against the
 * platform-neutral interfaces, because core must not depend on any adapter. These
 * overrides re-declare the same fixtures with the adapter's real classes, so PrestaShop
 * consumers get autocompletion for the page objects instead of the minimal interface.
 *
 * The fixtures themselves are unchanged — each override receives the value core built and
 * passes it straight through. See DECISIONS.md D-013.
 */
export const test = kitTest.extend<{
  storefront: Storefront;
  admin: AdminPanel;
  testOrder: PrestaShopTestOrderFactory;
}, {
  shopCli: PrestaShopCli;
}>({
  storefront: async ({ storefront }, use) => {
    await use(storefront as Storefront);
  },
  admin: async ({ admin }, use) => {
    await use(admin as AdminPanel);
  },
  testOrder: async ({ testOrder }, use) => {
    await use(testOrder as PrestaShopTestOrderFactory);
  },
  shopCli: [
    async ({ shopCli }, use) => {
      await use(shopCli as PrestaShopCli);
    },
    { scope: 'worker' },
  ],
});

export { expect };
