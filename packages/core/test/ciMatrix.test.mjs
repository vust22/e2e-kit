import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciMatrix } from '../dist/config/ciMatrix.js';

/** Minimal validated-config shape; ciMatrix only reads these fields. */
function cfg(overrides = {}) {
  return {
    module: { name: 'demo' },
    platform: { versions: ['8', '9'] },
    ci: { shards: 2, retries: 1 },
    ...overrides,
  };
}

test('expands platform versions x shards', () => {
  const m = ciMatrix(cfg());
  assert.equal(m.mock.length, 4);
  assert.deepEqual(
    m.mock.map((e) => `${e.ps}:${e.shard}`),
    ['8:1/2', '8:2/2', '9:1/2', '9:2/2'],
  );
});

test('a single shard still produces one entry per version', () => {
  const m = ciMatrix(cfg({ ci: { shards: 1, retries: 1 } }));
  assert.deepEqual(
    m.mock.map((e) => e.shard),
    ['1/1', '1/1'],
  );
  assert.equal(m.mock.length, 2);
});

test('sandbox is empty and disabled when the config has no psp block', () => {
  const m = ciMatrix(cfg());
  assert.equal(m.sandboxEnabled, false);
  assert.deepEqual(m.sandbox, []);
  assert.deepEqual(m.requiredSecrets, []);
});

test('sandbox expands per version, never per shard, when enabled', () => {
  const m = ciMatrix(
    cfg({
      psp: {
        sandbox: { enabled: true, blocking: false, requiredSecrets: ['MOLLIE_TEST_API_KEY'] },
      },
    }),
  );
  assert.equal(m.sandboxEnabled, true);
  assert.deepEqual(m.sandbox, [{ ps: '8' }, { ps: '9' }]);
  assert.deepEqual(m.requiredSecrets, ['MOLLIE_TEST_API_KEY']);
  assert.equal(m.sandboxBlocking, false);
});

test('a psp block with sandbox disabled yields no sandbox jobs and leaks no secret names', () => {
  const m = ciMatrix(
    cfg({ psp: { sandbox: { enabled: false, blocking: false, requiredSecrets: ['NOPE'] } } }),
  );
  assert.equal(m.sandboxEnabled, false);
  assert.deepEqual(m.sandbox, []);
  assert.deepEqual(
    m.requiredSecrets,
    [],
    'secrets must not be emitted when sandbox is off (spec §11)',
  );
});

test('carries the module name through for job labels', () => {
  assert.equal(ciMatrix(cfg()).moduleName, 'demo');
});
