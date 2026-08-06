import { defineE2EConfig } from '@invertus/e2e-core';

/**
 * File #2 of the "2-file adoption" (spec §5.1, §5.3).
 *
 * This module has no PSP, which is deliberate: it keeps the no-payment path — the one a
 * shipping, tax or UI module would take — covered by the kit's own CI.
 */
export default defineE2EConfig({
  module: {
    name: 'e2e_consumer',
    build: '',
    source: './e2e_consumer',
  },
  platform: {
    type: 'prestashop',
    versions: ['8', '9'],
    imageOverride: null,
  },
  suites: {
    shared: ['install', 'configure'],
    custom: 'e2e/specs/**/*.spec.ts',
  },
  ci: { shards: 1, retries: 1 },
});
