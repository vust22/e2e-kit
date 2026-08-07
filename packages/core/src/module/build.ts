import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { runOrThrow } from '../env/process.js';
import type { E2EConfig } from '../config/schema.js';

/**
 * Prepare a consumer module for installation (spec §8.2: "Module build runs on the runner; the
 * built directory is bind-mounted into the shop container").
 *
 * The module is always **copied** to a build directory first, and the build command runs there.
 * Two reasons, both learned the hard way:
 *
 *  1. A build that writes into the checkout (`composer install`, `npm run build`) makes the
 *     "module source is unmodified" guarantee unverifiable — and for the Mollie pilot the
 *     source tree is explicitly read-only. Copying keeps `git diff` in the module repo empty
 *     by construction rather than by discipline.
 *  2. Trust-bundle patching (`trustBundles`, DECISIONS.md D-014) mutates a file under
 *     `vendor/`. That must never touch the developer's checkout.
 */

/** Where prepared module trees live, relative to the consumer repo root. */
export const MODULE_BUILD_DIR = path.join('.e2e-kit', 'module-build');

export interface PrepareModuleOptions {
  /** Consumer repo root — where `.e2e-kit/` lives and where `module.source` resolves from. */
  cwd: string;
  config: E2EConfig;
  /** Skip the copy+build if the prepared tree already looks complete. */
  reuse?: boolean;
  onProgress?: (message: string) => void;
}

export interface PreparedModule {
  /** Absolute path to the prepared tree; hand this to `installModule({ sourceDir })`. */
  sourceDir: string;
  /** True when an existing prepared tree was reused instead of rebuilt. */
  reused: boolean;
  /** Trust bundles that were patched, relative to `sourceDir`. */
  patchedBundles: string[];
}

export class ModuleBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModuleBuildError';
  }
}

export function preparedModuleDir(cwd: string, moduleName: string): string {
  return path.join(cwd, MODULE_BUILD_DIR, moduleName);
}

/**
 * The directory a suite should install from: the prepared tree when one exists, otherwise the
 * declared source. Modules with no build step and no trust bundles never need preparing, so
 * this keeps `install` working for them without an extra command.
 */
export function resolveModuleSourceDir(cwd: string, config: E2EConfig): string {
  const prepared = preparedModuleDir(cwd, config.module.name);
  if (existsSync(prepared)) return prepared;
  return path.resolve(cwd, config.module.source);
}

/** Directories never worth copying into the build tree or the bind mount. */
const EXCLUDED_TOP_LEVEL = new Set(['.git', 'node_modules', '.e2e-kit']);

/**
 * Copy a module checkout into the build tree, **entry by entry rather than in one call**.
 *
 * The obvious implementation — a single `cpSync(source, target, { recursive: true, filter })` —
 * cannot work when `module.source` is `'.'`, which is the normal case for a real consumer repo
 * (spec §5.3). The target is then `<source>/.e2e-kit/module-build/<name>`, i.e. *inside* the source,
 * and Node rejects that with `ERR_FS_CP_EINVAL` ("cannot copy to a subdirectory of self"). That check
 * is structural — it compares the two paths before walking anything — so the `filter` that excludes
 * `.e2e-kit` never gets a chance to run.
 *
 * Copying each top-level entry separately avoids it: no individual source entry is an ancestor of the
 * target once `.e2e-kit` is skipped.
 *
 * This was invisible for the whole Mollie pilot because `MOLLIE_MODULE_SOURCE` pointed at a separate
 * read-only clone (DECISIONS.md D-016), making source and target unrelated trees. It surfaced the first
 * time the kit ran in an actual consumer repository — see D-031.
 */
export function copyModuleTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source)) {
    if (EXCLUDED_TOP_LEVEL.has(entry)) continue;
    cpSync(path.join(source, entry), path.join(target, entry), {
      recursive: true,
      dereference: true,
      // Still needed for nested occurrences — a module may vendor its own node_modules deeper in.
      filter: (src) => !EXCLUDED_TOP_LEVEL.has(path.basename(src)),
    });
  }
}

export async function prepareModule(opts: PrepareModuleOptions): Promise<PreparedModule> {
  const { cwd, config } = opts;
  const log = opts.onProgress ?? (() => undefined);
  const source = path.resolve(cwd, config.module.source);
  const target = preparedModuleDir(cwd, config.module.name);

  if (!existsSync(source)) {
    throw new ModuleBuildError(`module.source does not exist: ${source}`);
  }
  if (!statSync(source).isDirectory()) {
    throw new ModuleBuildError(`module.source is not a directory: ${source}`);
  }

  if (opts.reuse && existsSync(target)) {
    log(`reusing prepared module at ${target}`);
    return { sourceDir: target, reused: true, patchedBundles: [] };
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });

  log(`copying ${source} -> ${target}`);
  copyModuleTree(source, target);

  if (config.module.build) {
    log(`running module build: ${config.module.build}`);
    await runOrThrow(['sh', '-lc', config.module.build], { cwd: target, inherit: true });
  }

  const patchedBundles = patchTrustBundles(target, config.module.trustBundles ?? [], log);

  return { sourceDir: target, reused: false, patchedBundles };
}

/**
 * Append the E2E CA to every CA bundle the module pins (DECISIONS.md D-014).
 *
 * A module that sets `CURLOPT_CAINFO` per request — as the Mollie module's own HTTP adapter
 * does — ignores both `curl.cainfo` and the OS trust store, so the E2E CA has to reach the file
 * that module actually reads. This is the same act as `update-ca-certificates`, performed at a
 * different path, and it happens in the build copy so nothing in the module checkout changes.
 */
export function patchTrustBundles(
  moduleDir: string,
  bundles: readonly string[],
  log: (message: string) => void = () => undefined,
): string[] {
  if (bundles.length === 0) return [];

  const caPath = e2eCaPath();
  if (!existsSync(caPath)) {
    throw new ModuleBuildError(
      `module.trustBundles is set but the E2E CA is missing at ${caPath}. ` +
        'Run `e2e-kit build-image` (or `node scripts/gen-ca.mjs`) first.',
    );
  }
  const ca = readFileSync(caPath, 'utf8');
  const patched: string[] = [];

  for (const relative of bundles) {
    const bundlePath = path.join(moduleDir, relative);
    if (!existsSync(bundlePath)) {
      throw new ModuleBuildError(
        `module.trustBundles lists '${relative}', which does not exist after the module build. ` +
          'Check the path, and that module.build actually produces it.',
      );
    }
    // A bundle already carrying the CA means the tree was prepared twice; appending again is
    // harmless to OpenSSL but makes the diff confusing, so skip it.
    if (readFileSync(bundlePath, 'utf8').includes(ca.trim())) {
      log(`trust bundle already carries the E2E CA: ${relative}`);
      continue;
    }
    appendFileSync(bundlePath, `\n# Invertus E2E CA (test-only, DECISIONS.md D-014)\n${ca}`, 'utf8');
    log(`appended the E2E CA to ${relative}`);
    patched.push(relative);
  }

  return patched;
}

/** The CA generated by `scripts/gen-ca.mjs`, resolved relative to this package. */
export function e2eCaPath(): string {
  // dist/module/build.js -> packages/core -> packages -> repo root
  const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  return path.resolve(packageRoot, '..', '..', 'images', 'prestashop', 'e2e-ca', 'e2e-ca.crt');
}
