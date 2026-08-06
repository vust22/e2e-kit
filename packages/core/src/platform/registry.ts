import type { PlatformAdapter } from './types.js';

/**
 * Platform type -> module specifier of its adapter entry point. Adding a platform
 * (Shopware, WooCommerce) means adding a line here and publishing that package; nothing
 * else in core changes.
 */
const ADAPTER_MODULES: Record<string, string> = {
  prestashop: '@invertus/e2e-prestashop/adapter',
};

export function knownPlatformTypes(): string[] {
  return Object.keys(ADAPTER_MODULES);
}

export class AdapterResolutionError extends Error {
  constructor(message: string, readonly platformType: string, reason?: unknown) {
    super(message, reason === undefined ? undefined : { cause: reason });
    this.name = 'AdapterResolutionError';
  }
}

const cache = new Map<string, PlatformAdapter>();

export async function loadPlatformAdapter(type: string): Promise<PlatformAdapter> {
  const cached = cache.get(type);
  if (cached) return cached;

  const specifier = ADAPTER_MODULES[type];
  if (!specifier) {
    throw new AdapterResolutionError(
      `Unknown platform type '${type}'. Known types: ${knownPlatformTypes().join(', ')}.`,
      type,
    );
  }

  let mod: { adapter?: PlatformAdapter };
  try {
    mod = (await import(specifier)) as { adapter?: PlatformAdapter };
  } catch (err) {
    throw new AdapterResolutionError(
      `Platform '${type}' requires '${specifier}', which could not be imported. ` +
        `Install it in the consumer repo: npm i -D ${specifier.split('/').slice(0, 2).join('/')}`,
      type,
      err,
    );
  }

  if (!mod.adapter || typeof mod.adapter.createShopCli !== 'function') {
    throw new AdapterResolutionError(
      `'${specifier}' does not export a valid PlatformAdapter as \`adapter\`.`,
      type,
    );
  }

  cache.set(type, mod.adapter);
  return mod.adapter;
}
