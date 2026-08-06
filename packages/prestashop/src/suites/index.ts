import type { SharedSuite } from '@invertus/e2e-core';
import { registerConfigureSuite } from './configure.suite.js';
import { registerInstallSuite } from './install.suite.js';

/**
 * The shared suites a consumer opts into with `suites.shared` (spec §5.3).
 *
 * A consumer materialises them with a single spec file:
 *
 * ```ts
 * import config from './e2e.config';
 * import { registerSharedSuites } from '@invertus/e2e-prestashop/suites';
 * registerSharedSuites(config.suites.shared);
 * ```
 *
 * Suites that are not implemented yet fail loudly at registration rather than silently
 * contributing zero tests — a suite that quietly runs nothing is worse than no suite,
 * because the run still goes green (Design principle 4).
 */
type SuiteRegistrar = () => void;

const notYet = (suite: string, phase: string): SuiteRegistrar => () => {
  throw new Error(
    `Shared suite '${suite}' is declared in e2e.config.ts but is not implemented yet ` +
      `(spec ${phase}). Remove it from suites.shared until then.`,
  );
};

export const SHARED_SUITE_REGISTRY: Record<SharedSuite, SuiteRegistrar> = {
  install: registerInstallSuite,
  configure: registerConfigureSuite,
  'checkout-matrix': notYet('checkout-matrix', '§5.3, Phase 3'),
  'back-office-verify': notYet('back-office-verify', '§6.3, Phase 3'),
  refund: notYet('refund', '§3.5, Phase 3'),
  'bo-order-management': notYet('bo-order-management', '§6.3a, Phase 3'),
};

export function registerSharedSuites(suites: readonly SharedSuite[]): void {
  for (const suite of suites) {
    const register = SHARED_SUITE_REGISTRY[suite];
    if (!register) {
      throw new Error(
        `Unknown shared suite '${suite}'. Known: ${Object.keys(SHARED_SUITE_REGISTRY).join(', ')}.`,
      );
    }
    register();
  }
}
