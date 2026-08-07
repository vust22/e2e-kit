/**
 * Resolve hook: let a TypeScript config import a sibling `.ts` file by its `.js` specifier.
 *
 * NodeNext-style TypeScript writes `import { MolliePsp } from './psp/MolliePsp.js'` even though
 * the file on disk is `.ts` — and that is exactly what spec §5.1's file set requires a consumer's
 * `e2e.config.ts` to do. Playwright's own loader rewrites the extension; plain Node with
 * `--experimental-strip-types` does not, so the CLI would fail to load a config that Playwright
 * loads fine. Rather than make consumers write a non-standard specifier to keep one of the two
 * tools happy, the CLI teaches Node the same rewrite.
 *
 * Deliberately narrow: it only fires when resolution has already failed and the `.ts` sibling
 * exists, so it can never shadow a real `.js` file.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!/\.js$/.test(specifier)) throw error;

    const asTs = specifier.replace(/\.js$/, '.ts');
    let candidate;
    try {
      candidate = new URL(asTs, context.parentURL);
    } catch {
      throw error;
    }
    if (candidate.protocol !== 'file:' || !existsSync(fileURLToPath(candidate))) throw error;

    return nextResolve(asTs, context);
  }
}
