import { defineE2EConfig } from '@invertus/e2e-core';
import { MolliePsp } from './psp/MolliePsp.js';

/**
 * File #2 of the "2-file adoption" (spec §5.1, §5.3) for the Mollie PrestaShop module.
 *
 * Everything module-specific is either here or in `psp/MolliePsp.ts`. The suites, page objects,
 * flows, images and CI all come from the kit.
 */
export default defineE2EConfig({
  module: {
    name: 'mollie',
    // The module ships no compiled front-end assets that the test suite needs, so the build is
    // just its PHP dependencies. `--no-dev` keeps the tree close to what merchants install.
    build: 'composer install --no-dev --no-interaction --no-progress --prefer-dist',
    // '.' in the module repo itself. The pilot runs against a read-only clone staged outside
    // this overlay (DECISIONS.md D-016), so the path is overridable — the committed default is
    // what a real adoption uses, and nothing about the file changes when it moves.
    source: process.env.MOLLIE_MODULE_SOURCE ?? '.',
    // The module's HTTP adapter pins this bundle with CURLOPT_CAINFO, overriding php.ini and the
    // OS trust store, so the E2E CA has to be appended here for mock mode to have any effect.
    // See e2e/NOTES.md §8 and the kit's DECISIONS.md D-014.
    trustBundles: ['vendor/composer/ca-bundle/res/cacert.pem'],
  },

  platform: {
    type: 'prestashop',
    versions: ['8', '9'],
    imageOverride: null,
  },

  psp: {
    implementation: MolliePsp,
    // Two of these use the Payments API and one the Orders API, which is how the matrix covers
    // both of the module's live payment-creation paths (NOTES.md §3).
    methodsUnderTest: ['ideal', 'creditcard', 'banktransfer'],
    outcomesUnderTest: ['paid', 'failed', 'canceled', 'expired'],
    sandbox: {
      enabled: true,
      blocking: false,
      requiredSecrets: ['MOLLIE_TEST_API_KEY'],
    },
  },

  suites: {
    shared: [
      'install',
      'configure',
      'checkout-matrix',
      'back-office-verify',
      'refund',
      'bo-order-management',
    ],
    custom: 'e2e/specs/**/*.spec.ts',
  },

  ci: { shards: 2, retries: 1 },
});
