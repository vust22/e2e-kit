#!/usr/bin/env node
/**
 * Stage a workspace package for publishing under a different npm scope
 * (DECISIONS.md D-022).
 *
 * GitHub Packages requires a package's scope to match the repository owner, so the kit cannot publish
 * `@invertus/*` from a `vust22`-owned repo. Renaming in the repo is not an option: 51 files import
 * `@invertus/e2e-core`, and they resolve through a workspace symlink keyed on that name.
 *
 * So the rename happens here, on a copy, at publish time. Two edits:
 *
 *   1. `name` -> `@<scope>/<base>`
 *   2. every `@invertus/e2e-*` runtime dependency -> an npm **alias**, keeping `@invertus/...` as the
 *      key and pointing it at `npm:@<scope>/...`
 *
 * Edit 2 is the load-bearing one. The compiled `dist` still contains `import '@invertus/e2e-core'`,
 * so the published package must declare a dependency that installs to *that* path. Without the alias
 * the published adapter resolves nothing at runtime.
 *
 * Deleting this script is the migration back to publishing `@invertus/*` directly.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SOURCE_SCOPE = '@invertus/';

/** Dependency fields a consumer actually installs. `devDependencies` is deliberately excluded. */
const RUNTIME_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * @param {Record<string, any>} manifest a parsed package.json
 * @param {string} scope target scope without `@` or `/`, e.g. `vust22`
 * @returns {Record<string, any>} a new manifest; the input is not mutated
 */
export function remapManifest(manifest, scope) {
  if (!manifest.name?.startsWith(SOURCE_SCOPE)) {
    throw new Error(
      `prepare-publish: expected a package named '${SOURCE_SCOPE}...', got '${manifest.name}'`,
    );
  }

  // A package.json is JSON by definition, so a round-trip is a sufficient deep copy — and it avoids
  // depending on `structuredClone` being declared as a global for this file group.
  const out = JSON.parse(JSON.stringify(manifest));
  out.name = `@${scope}/${manifest.name.slice(SOURCE_SCOPE.length)}`;

  for (const field of RUNTIME_DEP_FIELDS) {
    const deps = out[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith(SOURCE_SCOPE)) continue;
      const base = name.slice(SOURCE_SCOPE.length);
      // Key stays @invertus/* — see the note above.
      deps[name] = `npm:@${scope}/${base}@${range}`;
    }
  }

  return out;
}

function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const scopeFlagIndex = process.argv.indexOf('--scope');
  const scopeValue = scopeFlagIndex === -1 ? undefined : process.argv[scopeFlagIndex + 1];
  // The --scope VALUE lands in `positional` too; drop it so the paths stay correct.
  const [packageDir, stagingDir] = positional.filter((a) => a !== scopeValue);
  const scope = scopeValue ?? 'vust22';

  if (!packageDir || !stagingDir) {
    console.error('usage: prepare-publish.mjs <packageDir> <stagingDir> [--scope <scope>]');
    process.exit(1);
  }

  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const remapped = remapManifest(manifest, scope);

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  // Only the `files` allowlist is published, plus the manifest itself.
  for (const entry of manifest.files ?? []) {
    cpSync(path.join(packageDir, entry), path.join(stagingDir, entry), { recursive: true });
  }
  writeFileSync(path.join(stagingDir, 'package.json'), `${JSON.stringify(remapped, null, 2)}\n`);

  console.log(`prepare-publish: ${manifest.name} -> ${remapped.name} staged in ${stagingDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileUrl(process.argv[1])) main();

/** `import.meta.url` is a URL; argv[1] is a path. Compare them in one form. */
function pathToFileUrl(p) {
  return new URL(`file://${path.resolve(p)}`).href;
}
