import { test as base, expect } from '@playwright/test';
import { loadE2EConfig, resolveConfigPath, type E2EConfig } from '../config/index.js';
import { loadPlatformAdapter } from '../platform/registry.js';
import type {
  AdminPanel,
  PlatformAdapter,
  PlatformFixtures,
  ShopCli,
  ShopEnvironment,
  Storefront,
  TestOrderFactory,
} from '../platform/types.js';
import type { PspContract, PspContext } from '../psp/contract.js';
import {
  resolveConfigPathFromEnv,
  resolveSecrets,
  resolveShopEnvironment,
} from './environment.js';

export interface KitWorkerFixtures {
  /** The consumer's validated `e2e.config.ts`. */
  e2eConfig: E2EConfig;
  /** Coordinates of the running stack (URL, container, mode, credentials). */
  shopEnv: ShopEnvironment;
  /** The resolved platform adapter for `platform.type`. */
  adapter: PlatformAdapter;
  /** Executes platform console commands inside the shop container. */
  shopCli: ShopCli;
  /** The consumer's PSP implementation, already `setup()`-ed for this worker. */
  psp: PspContract;
}

export interface KitTestFixtures {
  /** Base URL of the shop under test. */
  shopUrl: string;
  /** Facade over storefront page objects. */
  storefront: PlatformFixtures['storefront'];
  /** Facade over back-office page objects; auto-logs-in using seeded admin credentials. */
  admin: PlatformFixtures['admin'];
  /** Creates isolated cart/order state per test. */
  testOrder: PlatformFixtures['testOrder'];
}

/** Builds a PspContext for the given page without re-reading the environment. */
export function pspContextFor(
  page: PspContext['page'],
  env: ShopEnvironment,
  config: E2EConfig,
): PspContext {
  return {
    page,
    shopUrl: env.shopUrl,
    mode: env.mode,
    secrets: resolveSecrets(env.mode, config.psp?.sandbox.requiredSecrets ?? []),
  };
}

class MissingPspError extends Error {
  constructor() {
    super(
      'This test used the `psp` fixture, but e2e.config.ts has no `psp` block. ' +
        'Add one for payment modules, or drop the PSP-dependent suites (spec §5.3).',
    );
    this.name = 'MissingPspError';
  }
}

export const test = base.extend<KitTestFixtures, KitWorkerFixtures>({
  e2eConfig: [
    async ({}, use) => {
      const cwd = process.cwd();
      const configPath = resolveConfigPathFromEnv(cwd) ?? resolveConfigPath(cwd);
      await use(await loadE2EConfig(configPath));
    },
    { scope: 'worker' },
  ],

  shopEnv: [
    async ({}, use) => {
      await use(resolveShopEnvironment());
    },
    { scope: 'worker' },
  ],

  adapter: [
    async ({ e2eConfig }, use) => {
      await use(await loadPlatformAdapter(e2eConfig.platform.type));
    },
    { scope: 'worker' },
  ],

  shopCli: [
    async ({ adapter, shopEnv }, use) => {
      await use(adapter.createShopCli(shopEnv));
    },
    { scope: 'worker' },
  ],

  psp: [
    async ({ e2eConfig, adapter, shopEnv, shopCli, browser }, use) => {
      if (!e2eConfig.psp) throw new MissingPspError();

      const instance = new e2eConfig.psp.implementation();

      // `setup` runs once per worker and needs a browser page for config-page driven
      // providers. It gets a dedicated context so it can never leak state into tests.
      const context = await browser.newContext({ baseURL: shopEnv.shopUrl });
      const page = await context.newPage();
      const admin = adapter.createAdminPanel(page, shopEnv);
      try {
        await instance.setup(pspContextFor(page, shopEnv, e2eConfig), { admin, shopCli });
      } finally {
        await context.close();
      }

      await use(instance);
    },
    { scope: 'worker' },
  ],

  shopUrl: async ({ shopEnv }, use) => {
    await use(shopEnv.shopUrl);
  },

  storefront: async ({ page, adapter, shopEnv }, use) => {
    await use(adapter.createStorefront(page, shopEnv) as PlatformFixtures['storefront']);
  },

  admin: async ({ page, adapter, shopEnv }, use) => {
    const admin = adapter.createAdminPanel(page, shopEnv);
    await use(admin as PlatformFixtures['admin']);
  },

  testOrder: async ({ adapter, shopEnv, shopCli, storefront, admin }, use) => {
    const factory: TestOrderFactory = adapter.createTestOrderFactory({
      env: shopEnv,
      shopCli,
      storefront: storefront as Storefront,
      admin: admin as AdminPanel,
    });
    await use(factory as PlatformFixtures['testOrder']);
  },
});

export { expect };
