import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { patchTrustBundles, IMAGE_CA_PATH } from '../dist/module/build.js';

const FAKE_CA = '-----BEGIN CERTIFICATE-----\nFAKECA\n-----END CERTIFICATE-----\n';

function moduleFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-trust-'));
  mkdirSync(path.join(root, 'vendor', 'composer', 'ca-bundle', 'res'), { recursive: true });
  writeFileSync(
    path.join(root, 'vendor', 'composer', 'ca-bundle', 'res', 'cacert.pem'),
    '-----BEGIN CERTIFICATE-----\nUPSTREAM\n-----END CERTIFICATE-----\n',
  );
  const caFile = path.join(root, 'ca.crt');
  writeFileSync(caFile, FAKE_CA);
  return { root, caFile, bundle: 'vendor/composer/ca-bundle/res/cacert.pem' };
}

test('patches a bundle from an explicitly supplied CA path', () => {
  const { root, caFile, bundle } = moduleFixture();
  try {
    const patched = patchTrustBundles(root, [bundle], () => undefined, caFile);
    assert.deepEqual(patched, [bundle]);
    const contents = readFileSync(path.join(root, bundle), 'utf8');
    assert.ok(contents.includes('UPSTREAM'), 'the upstream bundle must be preserved');
    assert.ok(contents.includes('FAKECA'), 'the E2E CA must be appended');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('is idempotent — a second patch does not append the CA twice', () => {
  const { root, caFile, bundle } = moduleFixture();
  try {
    patchTrustBundles(root, [bundle], () => undefined, caFile);
    const second = patchTrustBundles(root, [bundle], () => undefined, caFile);
    assert.deepEqual(second, [], 'nothing should be reported as patched the second time');
    const occurrences = readFileSync(path.join(root, bundle), 'utf8').split('FAKECA').length - 1;
    assert.equal(occurrences, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does nothing, and needs no CA, when no bundles are declared', () => {
  const { root } = moduleFixture();
  try {
    assert.deepEqual(patchTrustBundles(root, [], () => undefined, '/nonexistent/ca.crt'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails with an actionable message when the supplied CA is missing', () => {
  const { root, bundle } = moduleFixture();
  try {
    assert.throws(
      () => patchTrustBundles(root, [bundle], () => undefined, '/nonexistent/ca.crt'),
      /E2E CA is missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a declared bundle does not exist after the build', () => {
  const { root, caFile } = moduleFixture();
  try {
    assert.throws(
      () => patchTrustBundles(root, ['vendor/nope/cacert.pem'], () => undefined, caFile),
      /which does not exist after the module build/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the in-image CA location is the path the Dockerfile installs to', () => {
  assert.equal(IMAGE_CA_PATH, '/usr/local/share/ca-certificates/e2e-ca.crt');
});
