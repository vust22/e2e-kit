#!/usr/bin/env node
/**
 * `e2e-kit` CLI (spec §5.5).
 *
 * up | test | down | reset-db | build-image | doctor
 *
 * CI calls these exact commands, which is what keeps a developer's laptop and a runner on
 * the same code path (Goal 7). Anything that differs between the two must be an argument
 * to one of these commands, never a separate script.
 *
 * The consumer's `e2e.config.ts` is TypeScript, so this file re-executes itself under
 * `--experimental-strip-types` when Node does not already support importing it
 * (DECISIONS.md D-008).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// --- self re-exec with type stripping ------------------------------------------------
if (!process.env.E2E_KIT_STRIPPED) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, E2E_KIT_STRIPPED: '1' } },
  );
  process.exit(result.status ?? 1);
}

const core = await import(pathToFileURL(path.join(here, '..', 'dist', 'index.js')).href);
const {
  ComposeStack,
  loadE2EConfig,
  resolveConfigPath,
  waitForHttpOk,
  writeStackState,
  readStackStateOrThrow,
  readStackState,
  clearStackState,
  run,
  runOrThrow,
} = core;

// --- argument parsing ----------------------------------------------------------------
const [command, ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = rest[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function has(name) {
  return rest.includes(`--${name}`);
}

const cwd = process.cwd();
const repoRoot = path.resolve(here, '..', '..', '..');
const composeDir = path.join(repoRoot, 'compose');

function fail(message) {
  console.error(`\x1b[1;31m[e2e-kit]\x1b[0m ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`\x1b[1;36m[e2e-kit]\x1b[0m ${message}`);
}

function composeFilesFor(mode) {
  const files = [path.join(composeDir, 'docker-compose.yml')];
  const overlay = path.join(composeDir, `docker-compose.${mode}.yml`);
  if (existsSync(overlay)) files.push(overlay);
  return files;
}

function projectNameFor(config, psVersion) {
  return `e2e-${config.module.name}-ps${psVersion}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

async function loadConfig() {
  const configPath = resolveConfigPath(cwd, flag('config', undefined));
  const config = await loadE2EConfig(configPath);
  process.env.E2E_CONFIG_PATH = configPath;
  return { config, configPath };
}

// --- commands ------------------------------------------------------------------------

async function cmdUp() {
  const { config, configPath } = await loadConfig();
  const psVersion = String(flag('ps', config.platform.versions[0] ?? '8'));
  const mode = String(flag('mode', 'mock'));
  const port = String(flag('port', process.env.E2E_SHOP_PORT ?? '8080'));

  if (mode !== 'mock' && mode !== 'sandbox') fail(`--mode must be 'mock' or 'sandbox', got '${mode}'`);
  if (!config.platform.versions.includes(psVersion)) {
    fail(
      `--ps ${psVersion} is not in platform.versions (${config.platform.versions.join(', ')}) in ${configPath}`,
    );
  }

  const image = config.platform.imageOverride ?? process.env.E2E_PS_IMAGE ?? `e2e-ps:${psVersion}`;
  const domain = `localhost:${port}`;
  const projectName = projectNameFor(config, psVersion);

  const env = {
    E2E_PS_IMAGE: image,
    E2E_SHOP_PORT: port,
    E2E_SHOP_DOMAIN: domain,
    E2E_PSP_MODE: mode,
    E2E_PLATFORM: process.env.E2E_PLATFORM ?? 'linux/amd64',
  };

  const stack = new ComposeStack({ projectName, files: composeFilesFor(mode), cwd: repoRoot, env });

  info(`Booting ${image} as project '${projectName}' in ${mode} mode on port ${port}`);
  const started = Date.now();
  await stack.up({ inherit: true });

  const shopUrl = `http://${domain}`;
  await waitForHttpOk({
    url: `${shopUrl}/index.php`,
    timeoutMs: 180_000,
    onProgress: (m) => process.stdout.write(`\r\x1b[2K\x1b[1;36m[e2e-kit]\x1b[0m ${m}`),
  });
  process.stdout.write('\n');

  const shopContainer = await stack.containerIdOrThrow('shop');
  const dbContainer = await stack.containerIdOrThrow('db');

  writeStackState(cwd, {
    projectName,
    composeFiles: composeFilesFor(mode),
    platformType: config.platform.type,
    platformVersion: psVersion,
    mode,
    shopUrl,
    shopContainer,
    dbContainer,
    adminPath: process.env.E2E_ADMIN_PATH ?? '/admin-e2e',
    adminEmail: process.env.E2E_ADMIN_EMAIL ?? 'e2e.admin@invertus.test',
    adminPassword: process.env.E2E_ADMIN_PASSWORD ?? 'E2E_Admin_123!',
    moduleName: config.module.name,
    startedAt: new Date().toISOString(),
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  info(`Ready in ${seconds}s`);
  info(`  storefront  ${shopUrl}`);
  info(`  back office ${shopUrl}/admin-e2e  (e2e.admin@invertus.test / E2E_Admin_123!)`);
  if (seconds > 90) {
    info(`  note: boot took longer than the ${90}s CI budget (spec §8.2) — expected under emulation`);
  }
}

async function cmdTest() {
  const state = readStackStateOrThrow(cwd);
  const { configPath } = await loadConfig();

  const playwrightConfig = flag('playwright-config', undefined) ?? findPlaywrightConfig();
  if (!playwrightConfig) {
    fail(
      'No playwright.config.ts found. Add one that calls definePlaywrightConfig(), or pass --playwright-config.',
    );
  }

  const passthrough = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--grep' || arg === '-g') {
      passthrough.push('--grep', rest[++i]);
    } else if (arg === '--shard') {
      passthrough.push(`--shard=${rest[++i]}`);
    } else if (arg === '--headed' || arg === '--debug' || arg === '--ui') {
      passthrough.push(arg);
    } else if (arg.startsWith('--grep=') || arg.startsWith('--shard=') || arg.startsWith('--project=')) {
      passthrough.push(arg);
    }
  }

  info(`Running Playwright against ${state.shopUrl}`);
  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--config', playwrightConfig, ...passthrough],
    {
      stdio: 'inherit',
      cwd,
      env: {
        ...process.env,
        E2E_CONFIG_PATH: configPath,
        E2E_SHOP_URL: state.shopUrl,
        E2E_SHOP_CONTAINER: state.shopContainer,
        E2E_PSP_MODE: state.mode,
        E2E_PS_VERSION: state.platformVersion,
        E2E_ADMIN_PATH: state.adminPath,
        E2E_ADMIN_EMAIL: state.adminEmail,
        E2E_ADMIN_PASSWORD: state.adminPassword,
      },
    },
  );
  process.exit(result.status ?? 1);
}

function findPlaywrightConfig() {
  for (const name of ['playwright.config.ts', 'e2e/playwright.config.ts', 'playwright.config.js']) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function cmdDown() {
  const state = readStackState(cwd);
  if (!state) {
    info('No running stack recorded; nothing to tear down.');
    return;
  }
  const stack = new ComposeStack({
    projectName: state.projectName,
    files: state.composeFiles,
    cwd: repoRoot,
    env: { E2E_PLATFORM: process.env.E2E_PLATFORM ?? 'linux/amd64' },
  });
  info(`Tearing down '${state.projectName}'`);
  await stack.down({ volumes: true, inherit: true });
  clearStackState(cwd);
  info('Down.');
}

async function cmdResetDb() {
  const state = readStackStateOrThrow(cwd);
  info('Resetting the database to the baked seed state');
  const result = await run(['docker', 'exec', '-u', 'root', state.shopContainer, 'e2e-reset-db']);
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    process.stderr.write(result.stderr);
    fail(`reset-db failed with exit ${result.code}`);
  }
  info('Database reset.');
}

async function cmdBuildImage() {
  const args = ['scripts/build-image.mjs'];
  if (flag('ps', undefined)) args.push('--ps', String(flag('ps')));
  if (has('all')) args.push('--all');
  if (has('no-cache')) args.push('--no-cache');
  await runOrThrow(['node', ...args], { cwd: repoRoot, inherit: true });
}

async function cmdDoctor() {
  const checks = [];
  const dockerVersion = await run(['docker', 'version', '--format', '{{.Server.Version}}']);
  checks.push(['docker daemon', dockerVersion.code === 0, dockerVersion.stdout.trim() || dockerVersion.stderr.trim()]);

  const compose = await run(['docker', 'compose', 'version', '--short']);
  checks.push(['docker compose', compose.code === 0, compose.stdout.trim()]);

  const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
  checks.push(['node >= 22', nodeOk, process.versions.node]);

  const images = await run(['docker', 'images', '--format', '{{.Repository}}:{{.Tag}}']);
  const built = images.stdout.split('\n').filter((l) => l.startsWith('e2e-ps:'));
  checks.push(['seeded images built', built.length > 0, built.join(', ') || 'none — run `e2e-kit build-image`']);

  const state = readStackState(cwd);
  checks.push(['stack running', !!state, state ? `${state.projectName} at ${state.shopUrl}` : 'no']);

  let failed = false;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed = true;
    console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${name.padEnd(22)} ${detail}`);
  }
  process.exit(failed ? 1 : 0);
}

function usage() {
  console.log(`
e2e-kit — Invertus E2E testing kit

  e2e-kit up [--ps 8] [--mode mock|sandbox] [--port 8080]   boot the compose stack
  e2e-kit test [--grep <pattern>] [--shard 1/2] [--headed]  run Playwright against it
  e2e-kit down                                              tear the stack down
  e2e-kit reset-db                                          fast DB reset to seed state
  e2e-kit build-image [--ps 8|--all] [--no-cache]           build seeded platform images
  e2e-kit doctor                                            check the local environment
`);
}

const commands = {
  up: cmdUp,
  test: cmdTest,
  down: cmdDown,
  'reset-db': cmdResetDb,
  'build-image': cmdBuildImage,
  doctor: cmdDoctor,
};

const handler = commands[command];
if (!handler) {
  usage();
  process.exit(command ? 1 : 0);
}

try {
  await handler();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
