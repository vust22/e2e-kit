import path from 'node:path';
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
import { resolveModuleSourceDir } from '../module/build.js';
import { runOnce } from '../env/once.js';
import { stateFilePath } from '../env/state.js';

export interface KitWorkerFixtures {
  /** True once the module under test is installed in the running shop. */
  moduleInstalled: boolean;
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
  /**
   * The same instance, or null when `e2e.config.ts` declares no `psp` block.
   *
   * Fixtures cannot be depended on conditionally, so anything that works both with and without a
   * provider — the `testOrder` factory, most obviously — depends on this instead of `psp`.
   *
   * `auto`, for the same reason as `moduleInstalled`: `psp.setup` is what writes the module's API
   * credentials and seeds its payment methods, and a consumer's own specs assume a *configured*
   * module without declaring a dependency on the fixture that configures it. Without `auto`, a
   * spec that only asks for `admin` runs against an installed-but-unconfigured module and sees an
   * empty back office — which looks like a broken module rather than a missing fixture.
   */
  pspOrNull: PspContract | null;
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

  /**
   * The module under test, installed.
   *
   * `auto`, because an installed module is the premise of the entire kit: a consumer's own specs
   * reach for `admin` or `shopCli` and expect the module's config page, tables and order states to
   * exist, without it occurring to anyone to declare a dependency on installation. Without `auto`
   * the first spec alphabetically runs against a stock shop and fails with
   * "Table 'ps_mol_payment_method' doesn't exist", which reads like a broken module rather than a
   * missing fixture.
   *
   * Idempotent and coordinated across workers (D-019), so requesting it costs nothing after the
   * first time and no suite depends on `install` having run first (spec §7.2).
   */
  moduleInstalled: [
    async ({ e2eConfig, adapter, shopCli }, use) => {
      // Once per run, not once per worker: installing mutates the one shared shop, and several
      // workers doing it at the same time corrupts the module's tables.
      await runOnce({ stateDir: onceDir(), key: 'module-install' }, async () => {
        await adapter.ensureModuleInstalled(shopCli, {
          name: e2eConfig.module.name,
          sourceDir: resolveModuleSourceDir(process.cwd(), e2eConfig),
        });
        return true;
      });
      await use(true);
    },
    { scope: 'worker', auto: true },
  ],

  pspOrNull: [
    async ({ e2eConfig, adapter, shopEnv, shopCli, browser, moduleInstalled }, use) => {
      // Depending on `moduleInstalled` is the ordering guarantee: `psp.setup` writes module
      // configuration and module tables, neither of which exists before the module is installed.
      void moduleInstalled;
      if (!e2eConfig.psp) {
        await use(null);
        return;
      }

      // Spec §3.6: setup is "called once before the suite". It writes module configuration and
      // clears the shop cache, so running it per worker means concurrent cache clears against one
      // shop — which fail, in ways that look like anything but the cause. The instance is still
      // per worker (it holds no state worth sharing); only the shop-mutating work is coordinated.
      const instance = new e2eConfig.psp.implementation();
      await runOnce({ stateDir: onceDir(), key: `psp-setup-${instance.id}` }, async () => {
        await setUpPsp({ instance, e2eConfig, adapter, shopEnv, shopCli, browser });
        return true;
      });
      await use(instance);
    },
    { scope: 'worker', auto: true },
  ],

  psp: [
    async ({ pspOrNull }, use) => {
      if (!pspOrNull) throw new MissingPspError();
      await use(pspOrNull);
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

  testOrder: async ({ adapter, shopEnv, shopCli, storefront, admin, pspOrNull, e2eConfig }, use) => {
    const factory: TestOrderFactory = adapter.createTestOrderFactory({
      env: shopEnv,
      shopCli,
      storefront: storefront as Storefront,
      admin: admin as AdminPanel,
      psp: pspOrNull,
      pspContext: (page) => pspContextFor(page, shopEnv, e2eConfig),
    });
    await use(factory as PlatformFixtures['testOrder']);
  },
});

/** `psp.setup` runs once per worker; kept out of the fixture body so `pspOrNull` stays readable. */
async function setUpPsp(args: {
  instance: PspContract;
  e2eConfig: E2EConfig;
  adapter: PlatformAdapter;
  shopEnv: ShopEnvironment;
  shopCli: ShopCli;
  browser: import('@playwright/test').Browser;
}): Promise<PspContract> {
  const { instance, e2eConfig, adapter, shopEnv, shopCli, browser } = args;
  if (!e2eConfig.psp) throw new MissingPspError();

  // `setup` needs a browser page for config-page driven providers. It gets a dedicated
  // context so it can never leak state into tests.
  const context = await browser.newContext({ baseURL: shopEnv.shopUrl });
  const page = await context.newPage();
  const admin = adapter.createAdminPanel(page, shopEnv);
  try {
    await instance.setup(pspContextFor(page, shopEnv, e2eConfig), { admin, shopCli });
  } finally {
    await context.close();
  }

  return instance;
}

export { expect };

/** Where cross-worker coordination markers live: alongside the stack state, so `down` clears them. */
function onceDir(): string {
  return path.dirname(stateFilePath(process.cwd()));
}
