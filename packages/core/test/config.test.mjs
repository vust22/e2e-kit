import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defineE2EConfig,
  E2EConfigError,
  signWebhook,
  healOverrides,
  resetHealOverridesCache,
  resolveSecrets,
} from '../dist/index.js';

const minimal = {
  module: { name: 'demo_module' },
  platform: { type: 'prestashop' },
  suites: { shared: [] },
};

test('defineE2EConfig applies the documented defaults', () => {
  const config = defineE2EConfig(minimal);

  assert.equal(config.module.build, '');
  assert.equal(config.module.source, '.');
  assert.deepEqual(config.platform.versions, ['8']);
  assert.equal(config.platform.imageOverride, null);
  assert.equal(config.ci.shards, 1);
  assert.equal(config.ci.retries, 1);
  assert.equal(config.psp, undefined);
});

test('defineE2EConfig rejects a module name that is not a valid directory name', () => {
  assert.throws(
    () => defineE2EConfig({ ...minimal, module: { name: 'Demo-Module' } }),
    (err) => err instanceof E2EConfigError && /module\.name/.test(err.message),
  );
});

test("defineE2EConfig rejects 'checkout-matrix' without a psp block", () => {
  // The suite generates one test per method x outcome; with no PSP it would silently
  // contribute zero tests and the run would go green having verified nothing.
  assert.throws(
    () => defineE2EConfig({ ...minimal, suites: { shared: ['checkout-matrix'] } }),
    (err) => err instanceof E2EConfigError && /requires a `psp` block/.test(err.message),
  );
});

test('defineE2EConfig rejects sandbox mode with no declared secrets', () => {
  class DemoPsp {}
  assert.throws(
    () =>
      defineE2EConfig({
        ...minimal,
        psp: {
          implementation: DemoPsp,
          methodsUnderTest: ['card'],
          sandbox: { enabled: true, requiredSecrets: [] },
        },
      }),
    (err) => err instanceof E2EConfigError && /requiredSecrets/.test(err.message),
  );
});

test('defineE2EConfig accepts a full payment-module config', () => {
  class DemoPsp {}
  const config = defineE2EConfig({
    ...minimal,
    platform: { type: 'prestashop', versions: ['8', '9'] },
    psp: {
      implementation: DemoPsp,
      methodsUnderTest: ['ideal', 'creditcard'],
      outcomesUnderTest: ['paid', 'failed'],
      sandbox: { enabled: true, blocking: false, requiredSecrets: ['DEMO_TEST_API_KEY'] },
    },
    suites: { shared: ['install', 'checkout-matrix'], custom: 'e2e/specs/**/*.spec.ts' },
  });

  assert.equal(config.psp.implementation, DemoPsp);
  assert.deepEqual(config.psp.outcomesUnderTest, ['paid', 'failed']);
  assert.equal(config.psp.sandbox.blocking, false);
});

test('signWebhook is a stable HMAC', () => {
  const first = signWebhook('id=tr_123', 'shh');
  assert.equal(first, signWebhook('id=tr_123', 'shh'));
  assert.notEqual(first, signWebhook('id=tr_124', 'shh'));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.match(signWebhook('id=tr_123', 'shh', 'sha512'), /^[0-9a-f]{128}$/);
});

test('mock mode never resolves provider secrets, even when they are set', () => {
  // Spec §11: mock-mode jobs must run with zero provider secrets present.
  process.env.DEMO_TEST_API_KEY = 'live-looking-value';
  try {
    assert.deepEqual(resolveSecrets('mock', ['DEMO_TEST_API_KEY']), {});
  } finally {
    delete process.env.DEMO_TEST_API_KEY;
  }
});

test('sandbox mode fails loudly when a declared secret is missing', () => {
  delete process.env.DEMO_TEST_API_KEY;
  assert.throws(
    () => resolveSecrets('sandbox', ['DEMO_TEST_API_KEY']),
    /DEMO_TEST_API_KEY/,
  );
});

test('healOverrides is empty unless the harness sets the env var', () => {
  resetHealOverridesCache();
  delete process.env.E2E_HEAL_OVERRIDES;
  assert.deepEqual(healOverrides(), {});
});

test('a malformed override map is an error, never a silent no-op', () => {
  resetHealOverridesCache();
  process.env.E2E_HEAL_OVERRIDES = 'not json';
  try {
    assert.throws(() => healOverrides(), /not a JSON object/);
  } finally {
    delete process.env.E2E_HEAL_OVERRIDES;
    resetHealOverridesCache();
  }
});
