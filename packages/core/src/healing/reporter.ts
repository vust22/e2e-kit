import type { Reporter } from '@playwright/test/reporter';

/**
 * Self-healing harness entry point (spec §9).
 *
 * Phase 1 ships the export surface only. The reporter is intentionally inert: it
 * classifies nothing, captures nothing and calls no API. Phase 4 replaces this file with
 * the real implementation (trigger classification §9.1, capture bundles §9.2, Claude call
 * §9.3, validation §9.4, PR bot §9.5, guardrails §9.6).
 *
 * It is wired into the Playwright preset now so that turning healing on in Phase 4 is a
 * behaviour change in one file rather than a config change in every consumer repo.
 */
export interface HealingReporterOptions {
  /** Master switch. Defaults to false until Phase 4. */
  enabled?: boolean;
  /** Directory bundles are written to (spec §9.2). */
  outputDir?: string;
  /** Hard cap on heal attempts per job (spec §9.6). */
  maxAttemptsPerJob?: number;
  /** Skip healing entirely above this share of heal-eligible tests (spec §9.6). */
  massFailureThreshold?: number;
}

export const HEALING_DEFAULTS: Required<HealingReporterOptions> = {
  enabled: false,
  outputDir: 'healing-bundles',
  maxAttemptsPerJob: 10,
  massFailureThreshold: 0.3,
};

class InertHealingReporter implements Reporter {
  constructor(private readonly options: Required<HealingReporterOptions>) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(): void {
    if (this.options.enabled) {
      throw new Error(
        'healingReporter was enabled, but the self-healing harness is not implemented yet ' +
          '(spec §9 lands in Phase 4). Set enabled: false or remove the reporter.',
      );
    }
  }
}

/** Playwright reporter factory. Registered in the kit's Playwright preset. */
export function healingReporter(options: HealingReporterOptions = {}): Reporter {
  return new InertHealingReporter({ ...HEALING_DEFAULTS, ...options });
}
