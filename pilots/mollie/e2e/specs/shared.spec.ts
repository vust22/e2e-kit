import { registerSharedSuites } from '@invertus/e2e-prestashop';
import config from '../e2e.config.js';

/**
 * Materialises the shared suites this repo opted into in `e2e.config.ts`.
 *
 * One line is the whole integration: the suites themselves live in the kit, so adding coverage
 * across every consumer is a kit release rather than a change in each repo (Goal 3). For this
 * module that one line expands to the 12-cell checkout matrix plus the back-office,
 * refund and order-management suites.
 */
registerSharedSuites(config);
