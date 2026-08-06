import type {
  Page,
  PlatformAdapter,
  ShopEnvironment,
  TestOrderFactoryDeps,
} from '@invertus/e2e-core';
import { PrestaShopCli } from './cli/ShopCli.js';
import { AdminPanel } from './facades/AdminPanel.js';
import { Storefront } from './facades/Storefront.js';
import { PrestaShopTestOrderFactory } from './orders/TestOrderFactory.js';

/**
 * The PrestaShop platform adapter (spec §2).
 *
 * `@invertus/e2e-core` resolves this at runtime from `platform.type` in the consumer's
 * config, which is the seam a future Shopware or WooCommerce adapter plugs into without
 * anything in core changing.
 */
export const adapter: PlatformAdapter = {
  type: 'prestashop',

  createShopCli(env: ShopEnvironment) {
    return new PrestaShopCli(env);
  },

  createStorefront(page: Page, env: ShopEnvironment) {
    return new Storefront(page, env);
  },

  createAdminPanel(page: Page, env: ShopEnvironment) {
    return new AdminPanel(page, env);
  },

  createTestOrderFactory(deps: TestOrderFactoryDeps) {
    return new PrestaShopTestOrderFactory(deps);
  },
};

export default adapter;
