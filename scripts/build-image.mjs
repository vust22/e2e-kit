#!/usr/bin/env node
/**
 * Build a seeded PrestaShop image locally (spec §4.1, §4.3).
 *
 * Steps: compile the adapter package -> emit the seed manifest from `dataset.ts` ->
 * ensure the E2E CA exists -> `docker build` the target from `build-matrix.json`.
 *
 * Usage: node scripts/build-image.mjs [--ps 8] [--no-cache] [--all]
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = path.join(repoRoot, 'images', 'prestashop', 'build-matrix.json');
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));

const argv = process.argv.slice(2);
const psArgIndex = argv.indexOf('--ps');
const requestedTag = psArgIndex >= 0 ? argv[psArgIndex + 1] : undefined;
const buildAll = argv.includes('--all');
const noCache = argv.includes('--no-cache');

const targets = buildAll
  ? matrix.targets
  : matrix.targets.filter((t) => t.tag === (requestedTag ?? '8'));

if (targets.length === 0) {
  console.error(
    `No target matches --ps ${requestedTag}. Known tags: ${matrix.targets.map((t) => t.tag).join(', ')}`,
  );
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  console.log(`\n\x1b[1;34m$\x1b[0m ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
}

// 1. The manifest is generated from dataset.ts, so the adapter must be compiled first.
sh('npm', ['run', 'build', '-w', '@invertus/e2e-prestashop']);

const { serialiseSeedManifest } = await import(
  path.join(repoRoot, 'packages', 'prestashop', 'dist', 'seed', 'index.js')
);
const manifestOut = path.join(repoRoot, 'images', 'prestashop', 'seed', 'manifest.json');
mkdirSync(path.dirname(manifestOut), { recursive: true });
writeFileSync(manifestOut, serialiseSeedManifest(), 'utf8');
console.log(`[build-image] wrote ${path.relative(repoRoot, manifestOut)}`);

// 2. The CA must exist before the image build copies it in (DECISIONS.md D-009).
sh('node', ['scripts/gen-ca.mjs', '--host', 'api.mollie.com']);

// 3. Build each requested target.
for (const target of targets) {
  const imageTag = `e2e-ps:${target.tag}`;
  const args = [
    'build',
    '--platform', matrix.platform,
    '-f', 'images/prestashop/Dockerfile',
    '-t', imageTag,
    '--build-arg', `PS_BASE=${target.base}`,
    '--build-arg', `PS_MAJOR=${target.tag}`,
    ...(noCache ? ['--no-cache'] : []),
    '--progress', 'plain',
    '.',
  ];
  sh('docker', args);
  console.log(`\n\x1b[1;32m[build-image] built ${imageTag} from ${target.base}\x1b[0m`);
}
