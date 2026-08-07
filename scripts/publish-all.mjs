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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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

let published = false;
for (const pkg of PACKAGES) {
  const staging = path.join('/tmp', `publish-${path.basename(pkg)}`);
  runOrDie('node', ['scripts/prepare-publish.mjs', pkg, staging, '--scope', SCOPE]);

  const manifest = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'));
  if (alreadyPublished(manifest.name, manifest.version)) {
    console.log(`skip: ${manifest.name}@${manifest.version} is already published`);
    continue;
  }

  runOrDie('npm', ['publish', '--registry', REGISTRY, '--access', 'public'], { cwd: staging });
  published = true;
}

// changesets/action reads stdout to decide whether post-publish steps run.
console.log(published ? 'published' : 'nothing to publish');
