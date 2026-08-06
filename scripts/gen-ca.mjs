#!/usr/bin/env node
/**
 * Generate the E2E CA and any provider leaf certificates (spec §4.1 item 9, §6.4 item 2).
 *
 * Key material is generated per build and never committed (DECISIONS.md D-009). The CA
 * certificate is baked into the PrestaShop image's trust store; leaf certificates go to
 * the mock service images. Because both come from this one invocation, a PS image and a
 * mock image are only compatible if built together — the CLI enforces that by calling
 * this script once per `build` run.
 *
 * Usage: node scripts/gen-ca.mjs [--force] [--host api.mollie.com --host ...]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const caDir = path.join(repoRoot, 'images', 'prestashop', 'e2e-ca');

const args = process.argv.slice(2);
const force = args.includes('--force');
const hosts = args.reduce((acc, arg, i) => {
  if (arg === '--host' && args[i + 1]) acc.push(args[i + 1]);
  return acc;
}, []);

const CA_KEY = path.join(caDir, 'e2e-ca.key');
const CA_CRT = path.join(caDir, 'e2e-ca.crt');

function openssl(argv, opts = {}) {
  return execFileSync('openssl', argv, { encoding: 'utf8', ...opts });
}

function generateCa() {
  mkdirSync(caDir, { recursive: true });
  if (!force && existsSync(CA_KEY) && existsSync(CA_CRT)) {
    console.log(`[gen-ca] reusing existing CA at ${CA_CRT}`);
    return;
  }
  console.log('[gen-ca] generating a new E2E CA');
  openssl(['genrsa', '-out', CA_KEY, '4096']);
  openssl([
    'req', '-x509', '-new', '-nodes',
    '-key', CA_KEY,
    '-sha256',
    '-days', '3650',
    '-out', CA_CRT,
    '-subj', '/C=LT/O=Invertus E2E/OU=Testing/CN=Invertus E2E Root CA',
  ]);
  console.log(`[gen-ca] wrote ${CA_CRT}`);
}

function generateLeaf(host) {
  const leafDir = path.join(caDir, 'leaf', host);
  mkdirSync(leafDir, { recursive: true });
  const key = path.join(leafDir, 'server.key');
  const csr = path.join(leafDir, 'server.csr');
  const crt = path.join(leafDir, 'server.crt');
  const ext = path.join(leafDir, 'server.ext');

  writeFileSync(
    ext,
    [
      'authorityKeyIdentifier=keyid,issuer',
      'basicConstraints=CA:FALSE',
      'keyUsage=digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=DNS:${host},DNS:*.${host}`,
      '',
    ].join('\n'),
    'utf8',
  );

  openssl(['genrsa', '-out', key, '2048']);
  openssl(['req', '-new', '-key', key, '-out', csr, '-subj', `/C=LT/O=Invertus E2E/CN=${host}`]);
  openssl([
    'x509', '-req',
    '-in', csr,
    '-CA', CA_CRT,
    '-CAkey', CA_KEY,
    '-CAcreateserial',
    '-out', crt,
    '-days', '825',
    '-sha256',
    '-extfile', ext,
  ]);
  console.log(`[gen-ca] issued leaf certificate for ${host}`);
}

generateCa();
for (const host of hosts) generateLeaf(host);

// A fingerprint makes "the PS image and the mock image were built from different CAs"
// diagnosable at a glance instead of surfacing as an opaque TLS error.
const fingerprint = openssl(['x509', '-in', CA_CRT, '-noout', '-fingerprint', '-sha256'])
  .trim()
  .split('=')[1];
writeFileSync(path.join(caDir, 'fingerprint.txt'), `${fingerprint}\n`, 'utf8');
console.log(`[gen-ca] CA SHA-256 fingerprint: ${fingerprint}`);

if (!existsSync(CA_CRT) || readFileSync(CA_CRT, 'utf8').length === 0) {
  console.error('[gen-ca] CA certificate is missing or empty');
  process.exit(1);
}
