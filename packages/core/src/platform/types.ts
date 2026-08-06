import type { Page } from '@playwright/test';
import type { HostedCheckoutOutcome } from '../psp/contract.js';

/**
 * Platform-neutral contracts that a platform adapter (e.g. `@invertus/e2e-prestashop`)
 * implements. Core declares them so that fixtures, flows and the PSP contract can be
 * typed without core depending on any adapter — that dependency only runs one way.
 *
 * Adapters widen these types for consumers through declaration merging on
 * {@link PlatformFixtures}; see `packages/prestashop/src/augment.ts`.
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Describes the running shop the current worker is talking to. */
export interface ShopEnvironment {
  /** Base URL Playwright navigates to, e.g. `http://localhost:8080`. */
  shopUrl: string;
  /** Docker container name or id of the shop, for `docker exec`. */
  container: string;
  /** Back-office path, e.g. `/admin-e2e`. */
  adminPath: string;
  adminEmail: string;
  adminPassword: string;
  mode: 'mock' | 'sandbox';
  /** Platform major version tag, e.g. `'8'`. */
  platformVersion: string;
}

/** Executes commands inside the shop container. */
export interface ShopCli {
  /** Run an arbitrary argv inside the shop container. Never throws on non-zero. */
  exec(argv: string[]): Promise<ExecResult>;
  /** Run a platform console command (PrestaShop: `bin/console`). Throws on non-zero exit. */
  console(command: string, args?: string[]): Promise<ExecResult>;
  /** Run a SQL statement against the shop database and return raw stdout. */
  sql(query: string): Promise<string>;
  /** Write module configuration values directly (fast, UI-independent). */
  setModuleConfig(moduleName: string, values: Record<string, string>): Promise<void>;
  /** Read a single configuration value, or null when unset. */
  getConfig(name: string): Promise<string | null>;
  /** Copy a host path into the container. */
  copyIn(hostPath: string, containerPath: string): Promise<void>;
}

/** Minimum surface core relies on. Adapters expose far more (page objects). */
export interface Storefront {
  readonly page: Page;
  /** Navigate to the shop home page. */
  goHome(): Promise<void>;
}

/** Minimum surface core relies on. Adapters expose far more (page objects). */
export interface AdminPanel {
  readonly page: Page;
  /** Ensure an authenticated back-office session exists. */
  login(): Promise<void>;
  /** Navigate to a back-office controller by legacy/route name. */
  goToController(controller: string): Promise<void>;
}

export interface TestOrderRef {
  /** The shop's order reference, e.g. `ABCDEFGHI`. */
  reference: string;
  /** Numeric order id when known. */
  orderId?: number;
  /** Provider-side payment id when the order went through a PSP. */
  providerPaymentId?: string;
}

export interface CreateOrderOptions {
  productId?: number;
  quantity?: number;
  guest?: boolean;
  method?: string;
}

/**
 * Produces isolated order state per test (spec §7.4, §6.3a). `viaCheckout` is the
 * high-fidelity browser path; `createOrder`/`createPaidOrder` are the fast path used by
 * back-office focused suites.
 */
export interface TestOrderFactory {
  viaCheckout(opts?: CreateOrderOptions): Promise<TestOrderRef>;
  createOrder(outcome: HostedCheckoutOutcome, opts?: CreateOrderOptions): Promise<TestOrderRef>;
  createPaidOrder(opts?: CreateOrderOptions): Promise<TestOrderRef>;
}

export interface TestOrderFactoryDeps {
  env: ShopEnvironment;
  shopCli: ShopCli;
  storefront: Storefront;
  admin: AdminPanel;
}

/** What a platform package must export as `adapter` from its `/adapter` entry point. */
export interface PlatformAdapter {
  readonly type: string;
  createShopCli(env: ShopEnvironment): ShopCli;
  createStorefront(page: Page, env: ShopEnvironment): Storefront;
  createAdminPanel(page: Page, env: ShopEnvironment): AdminPanel;
  createTestOrderFactory(deps: TestOrderFactoryDeps): TestOrderFactory;
}

/**
 * Fixture types that platform adapters widen via declaration merging. Core ships the
 * neutral shape; importing an adapter package in the same TypeScript program upgrades
 * `storefront` and `admin` to that adapter's concrete facades.
 */
export interface PlatformFixtures {
  storefront: Storefront;
  admin: AdminPanel;
  testOrder: TestOrderFactory;
}
