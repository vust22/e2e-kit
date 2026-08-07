import path from 'node:path';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import type { E2EConfig } from '../config/schema.js';
import { resolveShopEnvironment } from '../fixtures/environment.js';

export interface PresetOptions {
  /** The consumer's validated config; drives retries, shards and suite selection. */
  config: E2EConfig;
  /** Directories Playwright scans. Defaults to the kit's shared suites + `suites.custom`. */
  testDir?: string;
  /** Extra Playwright config merged last. */
  overrides?: PlaywrightTestConfig;
}

const isCI = !!process.env.CI;

/**
 * The single Playwright configuration used by the kit, the example consumer and every
 * consumer repo. Centralising it is what makes §8.2's artifact and retry policy uniform.
 */
export function definePlaywrightConfig(opts: PresetOptions): PlaywrightTestConfig {
  const env = resolveShopEnvironment();
  const { config } = opts;

  // Sandbox jobs tolerate more external flake than mock jobs (spec §8.2).
  const retries = env.mode === 'sandbox' ? Math.max(config.ci.retries, 2) : config.ci.retries;

  return defineConfig({
    testDir: opts.testDir ?? process.cwd(),
    testMatch: ['**/*.spec.ts'],
    fullyParallel: true,
    forbidOnly: isCI,
    retries,
    // A payment module's shared suites all mutate the same shop: they install the module, rewrite
    // its configuration and seed its tables. Those are per-*run* mutations, and the worker-scoped
    // fixtures that perform them race when several workers share one shop — concurrent module
    // installs and concurrent `cache:clear` both fail outright rather than degrade. Until that
    // setup moves into a Playwright global-setup step, a PSP-bearing config runs single-worker.
    // Non-payment modules keep the parallelism, because they mutate nothing shared.
    workers: config.psp ? 1 : isCI ? 2 : undefined,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    // Absolute, anchored on the directory the CLI was invoked from — the consumer repo root.
    //
    // Relative reporter/output paths are resolved against the *config file's* directory. Since the kit
    // may generate that config inside `.e2e-kit/` (D-034), a relative path put artifacts somewhere the
    // workflow does not look: CI collected nothing and the run still reported green (D-035).
    outputDir: path.resolve(process.cwd(), 'test-results'),

    reporter: [
      ['list'],
      ['html', { open: 'never', outputFolder: path.resolve(process.cwd(), 'playwright-report') }],
      ...(isCI
        ? ([['blob', { outputDir: path.resolve(process.cwd(), 'blob-report') }]] as const)
        : []),
    ] as PlaywrightTestConfig['reporter'],

    use: {
      baseURL: env.shopUrl,
      trace: 'on-first-retry',
      video: 'retain-on-failure',
      screenshot: 'only-on-failure',
      actionTimeout: 20_000,
      navigationTimeout: 30_000,
      // The seeded shop speaks plain HTTP inside the compose network (spec §4.1 item 4).
      ignoreHTTPSErrors: true,
      locale: 'en-US',
      timezoneId: 'Europe/Vilnius',
    },

    projects: [
      {
        name: `chromium-ps${env.platformVersion}`,
        use: { ...devices['Desktop Chrome'] },
      },
    ],

    ...opts.overrides,
  });
}

export { defineConfig, devices };
