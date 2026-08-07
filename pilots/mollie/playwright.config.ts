import { definePlaywrightConfig } from '@invertus/e2e-core';
import config from './e2e/e2e.config.js';

/**
 * Consumers do not hand-write Playwright configuration: the kit's preset owns retries, artifacts,
 * timeouts and the reporter set, so every repo produces comparable output (spec §8.2).
 */
export default definePlaywrightConfig({
  config,
  testDir: './e2e/specs',
});
