#!/usr/bin/env node
/**
 * Publish every releasable package through the scope remap (DECISIONS.md D-025).
 *
 * `changesets/action` expects a single publish command, so this wraps the per-package staging: for
 * each package, stage a copy with the remapped manifest, then `npm publish` from the staging
 * directory. Publishing from the staging dir rather than the workspace is what keeps `@invertus/*`
 * in the repo and `@vust22/*` in the registry.
 *
 * Idempotent on purpose: a re-run after a partial failure (package 1 published, package 2 errored)
 * must not abort on the already-published version.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Where the outcome is recorded for the workflow to read.
 *
 * `changesets/action` derives its own `published` output by **parsing the publish command's stdout for
 * the `New tag:` lines that `changeset publish` emits**. This script publishes through a staging
 * directory instead (D-025), so it never produces those lines and that output is always false — which
 * silently skipped the tag step on the first real release. Reporting the result in a file we own is
 * explicit and does not depend on another action's parsing.
 */
const RESULT_FILE = 'publish-result.json';

const PACKAGES = ['packages/core', 'packages/prestashop'];
const SCOPE = process.env.PUBLISH_SCOPE ?? 'vust22';
const REGISTRY = process.env.PUBLISH_REGISTRY ?? 'https://npm.pkg.github.com';

function runOrDie(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

/** True when this exact name@version already exists in the registry. */
function alreadyPublished(name, version) {
  const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--registry', REGISTRY], {
    encoding: 'utf8',
  });
  return view.status === 0 && view.stdout.trim() === version;
}

const publishedPackages = [];
/** All packages share one version (`fixed` in .changeset/config.json, per spec §10). */
let version = null;

for (const pkg of PACKAGES) {
  const staging = path.join('/tmp', `publish-${path.basename(pkg)}`);
  runOrDie('node', ['scripts/prepare-publish.mjs', pkg, staging, '--scope', SCOPE]);

  const manifest = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'));
  version ??= manifest.version;

  if (alreadyPublished(manifest.name, manifest.version)) {
    console.log(`skip: ${manifest.name}@${manifest.version} is already published`);
    continue;
  }

  runOrDie('npm', ['publish', '--registry', REGISTRY, '--access', 'public'], { cwd: staging });
  publishedPackages.push(`${manifest.name}@${manifest.version}`);
}

const result = { published: publishedPackages.length > 0, version, packages: publishedPackages };
writeFileSync(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  result.published
    ? `published ${publishedPackages.join(', ')}`
    : 'nothing to publish (every version already exists in the registry)',
);
