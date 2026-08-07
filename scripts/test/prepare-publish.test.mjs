import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remapManifest } from '../prepare-publish.mjs';

test('rewrites the package name into the target scope', () => {
  const out = remapManifest({ name: '@invertus/e2e-core', version: '0.1.0' }, 'vust22');
  assert.equal(out.name, '@vust22/e2e-core');
});

test('rewrites an internal dependency to an npm alias so compiled imports still resolve', () => {
  const out = remapManifest(
    {
      name: '@invertus/e2e-prestashop',
      version: '0.1.0',
      dependencies: { '@invertus/e2e-core': '0.1.0', zod: '^4.4.3' },
    },
    'vust22',
  );
  // The KEY stays @invertus/* on purpose: dist contains `import '@invertus/e2e-core'`,
  // so the dependency must install to that path.
  assert.equal(out.dependencies['@invertus/e2e-core'], 'npm:@vust22/e2e-core@0.1.0');
  assert.equal(out.dependencies.zod, '^4.4.3', 'third-party deps must be untouched');
  assert.ok(!('@vust22/e2e-core' in out.dependencies), 'must not add a @vust22 key');
});

test('remaps peer and optional dependencies too', () => {
  const out = remapManifest(
    {
      name: '@invertus/e2e-prestashop',
      version: '0.1.0',
      peerDependencies: { '@invertus/e2e-core': '0.1.0' },
      optionalDependencies: { '@invertus/e2e-core': '0.1.0' },
    },
    'vust22',
  );
  assert.equal(out.peerDependencies['@invertus/e2e-core'], 'npm:@vust22/e2e-core@0.1.0');
  assert.equal(out.optionalDependencies['@invertus/e2e-core'], 'npm:@vust22/e2e-core@0.1.0');
});

test('leaves devDependencies alone — they are not installed by consumers', () => {
  const out = remapManifest(
    {
      name: '@invertus/e2e-core',
      version: '0.1.0',
      devDependencies: { '@invertus/e2e-prestashop': '0.1.0' },
    },
    'vust22',
  );
  assert.equal(out.devDependencies['@invertus/e2e-prestashop'], '0.1.0');
});

test('does not mutate its input', () => {
  const input = { name: '@invertus/e2e-core', version: '0.1.0', dependencies: {} };
  const snapshot = JSON.stringify(input);
  remapManifest(input, 'vust22');
  assert.equal(JSON.stringify(input), snapshot);
});

test('rejects a manifest outside the @invertus scope rather than guessing', () => {
  assert.throws(() => remapManifest({ name: 'e2e-core', version: '0.1.0' }, 'vust22'), /@invertus\//);
});
