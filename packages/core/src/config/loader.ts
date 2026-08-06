import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2EConfigError, E2EConfigSchema, type E2EConfig } from './schema.js';

const DEFAULT_CONFIG_PATHS = ['e2e/e2e.config.ts', 'e2e.config.ts'];

export function resolveConfigPath(cwd: string, explicit?: string): string {
  if (explicit) {
    const abs = path.resolve(cwd, explicit);
    if (!existsSync(abs)) {
      throw new E2EConfigError(`Config file not found: ${abs}`);
    }
    return abs;
  }
  for (const candidate of DEFAULT_CONFIG_PATHS) {
    const abs = path.resolve(cwd, candidate);
    if (existsSync(abs)) return abs;
  }
  throw new E2EConfigError(
    `No e2e config found. Expected one of: ${DEFAULT_CONFIG_PATHS.join(', ')} (relative to ${cwd}).`,
  );
}

/**
 * Import a consumer's `e2e.config.ts` and return the validated config.
 *
 * The file is TypeScript. Playwright transforms it itself; the plain-Node CLI relies on
 * `--experimental-strip-types`, which constrains the config to the type-stripping subset
 * (no `enum`, no `namespace`, no parameter properties) — see DECISIONS.md D-008.
 */
export async function loadE2EConfig(configPath: string): Promise<E2EConfig> {
  const url = pathToFileURL(configPath).href;
  let mod: { default?: unknown };
  try {
    mod = (await import(url)) as { default?: unknown };
  } catch (err) {
    const hint =
      err instanceof Error && /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/.test(err.message)
        ? '\nHint: run Node with --experimental-strip-types (the `e2e-kit` CLI does this for you).'
        : '';
    throw new E2EConfigError(`Failed to import ${configPath}: ${String(err)}${hint}`);
  }

  if (mod.default === undefined) {
    throw new E2EConfigError(
      `${configPath} has no default export. It must \`export default defineE2EConfig({...})\`.`,
    );
  }

  // defineE2EConfig already validated at module-evaluation time; re-parsing is cheap and
  // catches a hand-rolled object literal exported without going through the helper.
  const result = E2EConfigSchema.safeParse(mod.default);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.length ? i.path.join('.') : '<root>'}: ${i.message}`,
    );
    throw new E2EConfigError(`Invalid config in ${configPath}:\n${lines.join('\n')}`, result.error.issues);
  }
  return result.data;
}
