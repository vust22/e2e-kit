import type { E2EConfig, SharedSuite } from '@invertus/e2e-core';
import { registerConfigureSuite } from './configure.suite.js';
import { registerInstallSuite } from './install.suite.js';
import { registerCheckoutMatrixSuite } from './checkoutMatrix.suite.js';
import { registerBackOfficeVerifySuite } from './backOfficeVerify.suite.js';
import { registerRefundSuite } from './refund.suite.js';
import { registerBoOrderManagementSuite } from './boOrderManagement.suite.js';

/**
 * The shared suites a consumer opts into with `suites.shared` (spec §5.3).
 *
 * A consumer materialises them with a single spec file:
 *
 * ```ts
 * import config from './e2e.config';
 * import { registerSharedSuites } from '@invertus/e2e-prestashop/suites';
 * registerSharedSuites(config);
 * ```
 *
 * Registrars receive the whole validated config, because some of them generate tests from it —
 * `checkout-matrix` expands `psp.methodsUnderTest × psp.outcomesUnderTest`, and Playwright needs
 * every `test()` registered before the run starts, which rules out reading it from a fixture.
 */
export type SuiteRegistrar = (config: E2EConfig) => void;

export const SHARED_SUITE_REGISTRY: Record<SharedSuite, SuiteRegistrar> = {
  install: registerInstallSuite,
  configure: registerConfigureSuite,
  'checkout-matrix': registerCheckoutMatrixSuite,
  'back-office-verify': registerBackOfficeVerifySuite,
  refund: registerRefundSuite,
  'bo-order-management': registerBoOrderManagementSuite,
};

/**
 * Register every suite the config opts into.
 *
 * Takes the config rather than just the suite names so registrars can generate tests from it.
 * The old `registerSharedSuites(config.suites.shared)` shape is still accepted, because that is
 * what the onboarding doc and `examples/consumer-module` show; passing just the names means no
 * suite that generates tests from config can be used.
 */
export function registerSharedSuites(configOrSuites: E2EConfig | readonly SharedSuite[]): void {
  if (Array.isArray(configOrSuites)) {
    const generative = configOrSuites.filter((suite) => GENERATIVE_SUITES.has(suite));
    if (generative.length > 0) {
      throw new Error(
        `Suites ${generative.join(', ')} generate their tests from e2e.config.ts. ` +
          'Call registerSharedSuites(config) with the whole config instead of config.suites.shared.',
      );
    }
    for (const suite of configOrSuites) registerOne(suite, EMPTY_CONFIG);
    return;
  }

  const config = configOrSuites as E2EConfig;
  for (const suite of config.suites.shared) registerOne(suite, config);
}

/** Suites whose test list depends on the config, not just on the shop. */
const GENERATIVE_SUITES = new Set<SharedSuite>([
  'checkout-matrix',
  'back-office-verify',
  'refund',
  'bo-order-management',
]);

function registerOne(suite: SharedSuite, config: E2EConfig): void {
  const register = SHARED_SUITE_REGISTRY[suite];
  if (!register) {
    throw new Error(
      `Unknown shared suite '${suite}'. Known: ${Object.keys(SHARED_SUITE_REGISTRY).join(', ')}.`,
    );
  }
  register(config);
}

/**
 * Only ever handed to non-generative registrars, which read the config from the `e2eConfig`
 * fixture at run time and ignore this argument.
 */
const EMPTY_CONFIG = undefined as unknown as E2EConfig;
