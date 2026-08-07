import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  resolveSpecDir,
  synthesizePlaywrightConfig,
} from '../dist/reporting/synthesizeConfig.js';

test('derives the spec directory from a custom glob', () => {
  assert.equal(
    resolveSpecDir('/repo', { suites: { custom: 'e2e/specs/**/*.spec.ts' } }, '/repo/e2e/e2e.config.ts'),
    path.resolve('/repo/e2e/specs'),
  );
});

test('handles a glob with no directory depth', () => {
  assert.equal(
    resolveSpecDir('/repo', { suites: { custom: 'tests/*.spec.ts' } }, '/repo/e2e/e2e.config.ts'),
    path.resolve('/repo/tests'),
  );
});

test('falls back to <configDir>/specs when no custom glob is declared', () => {
  assert.equal(
    resolveSpecDir('/repo', { suites: {} }, '/repo/e2e/e2e.config.ts'),
    path.resolve('/repo/e2e/specs'),
  );
});

test('falls back when suites is absent entirely', () => {
  assert.equal(
    resolveSpecDir('/repo', {}, '/repo/e2e/e2e.config.ts'),
    path.resolve('/repo/e2e/specs'),
  );
});

test('writes an ESM-scoped config directory a CJS consumer can still load', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'e2e-synth-'));
  try {
    const written = synthesizePlaywrightConfig({
      cwd,
      config: { suites: { custom: 'e2e/specs/**/*.spec.ts' } },
      configPath: path.join(cwd, 'e2e', 'e2e.config.ts'),
    });

    assert.ok(existsSync(written), 'the config file must be written');
    assert.equal(path.basename(written), 'playwright.config.ts');

    // The whole point: a package.json marking this directory ESM, so Playwright loads the config
    // through `import` regardless of the consumer's own package type.
    const marker = path.join(path.dirname(written), 'package.json');
    assert.ok(existsSync(marker), 'an ESM marker package.json must sit beside the config');
    assert.equal(JSON.parse(readFileSync(marker, 'utf8')).type, 'module');

    const body = readFileSync(written, 'utf8');
    assert.match(body, /definePlaywrightConfig/);
    assert.match(body, /@invertus\/e2e-core/);
    // Absolute paths: the generated file lives in .e2e-kit/, not next to the consumer's config.
    assert.ok(body.includes(path.join(cwd, 'e2e', 'e2e.config.ts')), 'must import the real config path');
    assert.ok(body.includes(path.join(cwd, 'e2e', 'specs')), 'must point testDir at the spec dir');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('is idempotent — regenerating overwrites without appending', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'e2e-synth-'));
  try {
    const args = {
      cwd,
      config: { suites: { custom: 'e2e/specs/**/*.spec.ts' } },
      configPath: path.join(cwd, 'e2e', 'e2e.config.ts'),
    };
    const first = readFileSync(synthesizePlaywrightConfig(args), 'utf8');
    const second = readFileSync(synthesizePlaywrightConfig(args), 'utf8');
    assert.equal(first, second);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
