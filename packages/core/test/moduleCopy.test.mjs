import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyModuleTree } from '../dist/module/build.js';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-modcopy-'));
  writeFileSync(path.join(root, 'mollie.php'), '<?php // module entry');
  mkdirSync(path.join(root, 'src', 'Adapter'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'Adapter', 'Http.php'), '<?php');
  // The things that must never be copied.
  mkdirSync(path.join(root, '.git', 'objects'), { recursive: true });
  writeFileSync(path.join(root, '.git', 'config'), 'gitdir');
  mkdirSync(path.join(root, 'node_modules', 'cypress'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', 'cypress', 'index.js'), '//');
  return root;
}

test('copies into a target nested inside the source — the real-consumer `source: "."` case', () => {
  const root = fixture();
  // This is what a consumer repo produces: .e2e-kit/module-build/<name> lives INSIDE the source.
  const target = path.join(root, '.e2e-kit', 'module-build', 'mollie');
  try {
    copyModuleTree(root, target);
    assert.ok(existsSync(path.join(target, 'mollie.php')), 'module entry point must be copied');
    assert.ok(
      existsSync(path.join(target, 'src', 'Adapter', 'Http.php')),
      'nested sources must be copied',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('never copies .git, node_modules or .e2e-kit', () => {
  const root = fixture();
  const target = path.join(root, '.e2e-kit', 'module-build', 'mollie');
  try {
    copyModuleTree(root, target);
    const entries = readdirSync(target);
    assert.ok(!entries.includes('.git'), '.git must be excluded');
    assert.ok(!entries.includes('node_modules'), 'node_modules must be excluded');
    assert.ok(!entries.includes('.e2e-kit'), '.e2e-kit must be excluded (it contains the target)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('still works when the target is entirely outside the source', () => {
  const root = fixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), 'e2e-modcopy-out-'));
  const target = path.join(outside, 'module-build', 'mollie');
  try {
    copyModuleTree(root, target);
    assert.ok(existsSync(path.join(target, 'mollie.php')));
    assert.ok(!readdirSync(target).includes('.git'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
