/**
 * Public API of `@invertus/e2e-prestashop` — the PrestaShop platform adapter (spec §3.4).
 *
 * Consumers import `test`/`expect` from here (typed against the PrestaShop facades),
 * flows from `@invertus/e2e-prestashop/flows`, and seed constants from
 * `@invertus/e2e-prestashop/seed`.
 */

export { test, expect } from './test.js';
export { adapter } from './adapter.js';

// Facades
export { Storefront } from './facades/Storefront.js';
export { AdminPanel } from './facades/AdminPanel.js';

// CLI
export {
  PrestaShopCli,
  ShopCliError,
  PS_ROOT,
  DB_PREFIX,
  escapeSql,
} from './cli/ShopCli.js';

// Storefront page objects
export { HomePage } from './pages/storefront/HomePage.js';
export { ProductPage } from './pages/storefront/ProductPage.js';
export { CartPage } from './pages/storefront/CartPage.js';
export { CheckoutPage } from './pages/storefront/CheckoutPage.js';
export { OrderConfirmationPage } from './pages/storefront/OrderConfirmationPage.js';

// Back-office page objects
export { AdminLoginPage } from './pages/admin/AdminLoginPage.js';
export { AdminOrdersPage } from './pages/admin/AdminOrdersPage.js';
export { AdminOrderDetailPage } from './pages/admin/AdminOrderDetailPage.js';
export { AdminModulesPage } from './pages/admin/AdminModulesPage.js';
export { ModuleConfigPage } from './pages/admin/ModuleConfigPage.js';
export { BasePage } from './pages/BasePage.js';

// Orders
export {
  PrestaShopTestOrderFactory,
  type ViaCheckoutOptions,
} from './orders/TestOrderFactory.js';

// Flows and seed data are also available from the dedicated entry points.
export * from './flows/index.js';
export * from './seed/index.js';
export { registerSharedSuites, SHARED_SUITE_REGISTRY } from './suites/index.js';
