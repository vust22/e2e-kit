/**
 * Public API of `@invertus/e2e-core` (spec §3.3).
 *
 * Everything a consumer imports comes from here or from the platform adapter package.
 * Playwright is pinned by this package and re-exported — consumers must not depend on
 * `@playwright/test` directly (spec §3.2, enforced by `kit/no-direct-playwright-import`).
 */

// --- Spec §3.3 normative surface -------------------------------------------------
export { defineE2EConfig, type E2EConfig } from './config/index.js';
export { test, expect } from './fixtures/index.js';
export type { PspContract, HostedCheckoutOutcome } from './psp/contract.js';
export { signWebhook, postWebhook } from './psp/webhooks.js';
export { healingReporter } from './healing/reporter.js';

// --- Supporting types consumers and adapters need --------------------------------
export {
  E2EConfigSchema,
  E2EConfigError,
  SHARED_SUITES,
  loadE2EConfig,
  resolveConfigPath,
  type E2EConfigInput,
  type SharedSuite,
} from './config/index.js';

export {
  HOSTED_CHECKOUT_OUTCOMES,
  type PspContext,
  type PspSetupTools,
  type PspConstructor,
  type CompleteHostedCheckoutOptions,
  type EnsureWebhookProcessedOptions,
} from './psp/contract.js';

export { WebhookDeliveryError, type PostWebhookOptions } from './psp/webhooks.js';

export type {
  AdminPanel,
  CreateOrderOptions,
  ExecResult,
  PlatformAdapter,
  PlatformFixtures,
  ShopCli,
  ShopEnvironment,
  Storefront,
  TestOrderFactory,
  TestOrderFactoryDeps,
  TestOrderRef,
} from './platform/types.js';

export { loadPlatformAdapter, knownPlatformTypes, AdapterResolutionError } from './platform/registry.js';

export {
  pspContextFor,
  type KitTestFixtures,
  type KitWorkerFixtures,
} from './fixtures/index.js';
export {
  resolveShopEnvironment,
  resolveSecrets,
  resolveConfigPathFromEnv,
} from './fixtures/environment.js';

export {
  ComposeStack,
  dockerExec,
  dockerCopyIn,
  run,
  runOrThrow,
  CommandError,
  waitForHttpOk,
  waitFor,
  EnvBootError,
  readStackState,
  readStackStateOrThrow,
  writeStackState,
  clearStackState,
  stateFilePath,
  type ComposeStackOptions,
  type RunOptions,
  type StackState,
  type WaitForHttpOptions,
} from './env/index.js';

export { definePlaywrightConfig, type PresetOptions } from './reporting/index.js';

export {
  healOverrides,
  overrideFor,
  resetHealOverridesCache,
  HEALING_DEFAULTS,
  type HealOverrides,
  type HealingReporterOptions,
} from './healing/index.js';

// --- Re-exported Playwright surface (spec §3.2) ----------------------------------
export type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse,
  TestInfo,
} from '@playwright/test';
