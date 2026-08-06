import path from 'node:path';
import { readStackState, type StackState } from '../env/state.js';
import type { ShopEnvironment } from '../platform/types.js';

/**
 * Where the fixtures get their view of the running stack.
 *
 * Environment variables win over the on-disk state file, so CI (which exports them from
 * the reusable workflow) and a laptop (where `e2e-kit up` wrote the state file) take the
 * same code path with no branching.
 */
export function resolveShopEnvironment(cwd = process.cwd()): ShopEnvironment {
  const state: StackState | null = readStackState(cwd);

  const shopUrl = process.env.E2E_SHOP_URL ?? state?.shopUrl ?? 'http://localhost:8080';
  const container = process.env.E2E_SHOP_CONTAINER ?? state?.shopContainer ?? '';
  const mode = (process.env.E2E_PSP_MODE ?? state?.mode ?? 'mock') as 'mock' | 'sandbox';

  if (mode !== 'mock' && mode !== 'sandbox') {
    throw new Error(`E2E_PSP_MODE must be 'mock' or 'sandbox', got '${mode}'.`);
  }

  return {
    shopUrl: shopUrl.replace(/\/$/, ''),
    container,
    adminPath: process.env.E2E_ADMIN_PATH ?? state?.adminPath ?? '/admin-e2e',
    adminEmail: process.env.E2E_ADMIN_EMAIL ?? state?.adminEmail ?? 'e2e.admin@invertus.test',
    adminPassword: process.env.E2E_ADMIN_PASSWORD ?? state?.adminPassword ?? 'E2E_Admin_123!',
    mode,
    platformVersion: process.env.E2E_PS_VERSION ?? state?.platformVersion ?? '8',
  };
}

export function resolveConfigPathFromEnv(cwd = process.cwd()): string | undefined {
  const fromEnv = process.env.E2E_CONFIG_PATH;
  return fromEnv ? path.resolve(cwd, fromEnv) : undefined;
}

/**
 * Provider secrets for the current mode. Mock-mode jobs must run with zero provider
 * secrets present (spec §11), so this returns an empty object unless mode is sandbox.
 */
export function resolveSecrets(
  mode: 'mock' | 'sandbox',
  requiredSecrets: string[],
): Record<string, string> {
  if (mode !== 'sandbox') return {};

  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of requiredSecrets) {
    const value = process.env[name];
    if (!value) missing.push(name);
    else secrets[name] = value;
  }
  if (missing.length) {
    throw new Error(
      `Sandbox mode requires these secrets, which are not set: ${missing.join(', ')} (spec §11).`,
    );
  }
  return secrets;
}
