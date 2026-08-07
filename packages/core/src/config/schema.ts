import { z } from 'zod';
import { HOSTED_CHECKOUT_OUTCOMES, type PspConstructor } from '../psp/contract.js';

/** Shared suite names the kit knows how to generate (spec §5.3, §6.3a). */
export const SHARED_SUITES = [
  'install',
  'configure',
  'checkout-matrix',
  'back-office-verify',
  'refund',
  'bo-order-management',
] as const;

export type SharedSuite = (typeof SHARED_SUITES)[number];

const PspImplementation = z.custom<PspConstructor>(
  (value) => typeof value === 'function' && typeof (value as { prototype?: unknown }).prototype === 'object',
  { message: 'psp.implementation must be a class implementing PspContract' },
);

export const E2EConfigSchema = z
  .object({
    module: z.object({
      /** Directory name under `modules/`. */
      name: z
        .string()
        .min(1)
        .regex(/^[a-z0-9_]+$/, 'module.name must be lowercase alphanumeric/underscore'),
      /** Shell command run on the runner before install. Empty string when none. */
      build: z.string().default(''),
      /** Path to the module source within the consumer repo. */
      source: z.string().default('.'),
      /**
       * CA bundles inside the built module that the E2E CA must be appended to, relative to
       * the module root (DECISIONS.md D-014).
       *
       * Only needed by a module that pins its own bundle instead of trusting the system store —
       * for example one whose HTTP client sets `CURLOPT_CAINFO`, which overrides both
       * `curl.cainfo` and the OS trust store. Without this the mock's TLS handshake fails and
       * every provider call errors out. Empty for the overwhelming majority of modules.
       */
      trustBundles: z.array(z.string().min(1)).default([]),
    }),

    platform: z.object({
      type: z.enum(['prestashop']),
      /** Image tags to matrix over. */
      versions: z.array(z.string().min(1)).min(1).default(['8']),
      /** Pin an immutable image tag to escape a bad rebuild. */
      imageOverride: z.string().nullable().default(null),
    }),

    psp: z
      .object({
        implementation: PspImplementation,
        methodsUnderTest: z.array(z.string().min(1)).default([]),
        outcomesUnderTest: z.array(z.enum(HOSTED_CHECKOUT_OUTCOMES)).default(['paid']),
        sandbox: z
          .object({
            enabled: z.boolean().default(false),
            /** Sandbox jobs never block PRs (spec §8.4). */
            blocking: z.boolean().default(false),
            requiredSecrets: z.array(z.string().min(1)).default([]),
          })
          .default({ enabled: false, blocking: false, requiredSecrets: [] }),
      })
      .optional(),

    suites: z
      .object({
        shared: z.array(z.enum(SHARED_SUITES)).default([]),
        /** Glob for the consumer's own specs. */
        custom: z.string().optional(),
      })
      .default({ shared: [] }),

    /** Optional executable run inside the shop container after module install (spec §5.4). */
    seedHook: z.string().optional(),

    ci: z
      .object({
        shards: z.number().int().min(1).max(20).default(1),
        retries: z.number().int().min(0).max(5).default(1),
      })
      .default({ shards: 1, retries: 1 }),
  })
  .superRefine((cfg, ctx) => {
    const wantsCheckoutMatrix = cfg.suites.shared.includes('checkout-matrix');
    if (wantsCheckoutMatrix && !cfg.psp) {
      ctx.addIssue({
        code: 'custom',
        path: ['suites', 'shared'],
        message:
          "suite 'checkout-matrix' requires a `psp` block — it generates one test per method x outcome.",
      });
    }
    if (cfg.psp && cfg.psp.methodsUnderTest.length === 0 && wantsCheckoutMatrix) {
      ctx.addIssue({
        code: 'custom',
        path: ['psp', 'methodsUnderTest'],
        message: "'checkout-matrix' needs at least one method in psp.methodsUnderTest.",
      });
    }
    if (cfg.psp?.sandbox.enabled && cfg.psp.sandbox.requiredSecrets.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['psp', 'sandbox', 'requiredSecrets'],
        message:
          'sandbox.enabled is true but no requiredSecrets are declared; the sandbox job would run without provider credentials.',
      });
    }
  });

export type E2EConfigInput = z.input<typeof E2EConfigSchema>;
export type E2EConfig = z.output<typeof E2EConfigSchema>;

export class E2EConfigError extends Error {
  constructor(message: string, readonly issues: z.core.$ZodIssue[] = []) {
    super(message);
    this.name = 'E2EConfigError';
  }
}

/**
 * Validate and normalise a consumer's `e2e.config.ts`. Validation happens at import
 * time, so an invalid config fails the run before anything boots (spec §5.3).
 */
export function defineE2EConfig(input: E2EConfigInput): E2EConfig {
  const result = E2EConfigSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.length ? i.path.join('.') : '<root>'}: ${i.message}`,
    );
    throw new E2EConfigError(
      `Invalid e2e.config.ts:\n${lines.join('\n')}`,
      result.error.issues,
    );
  }
  return result.data;
}
