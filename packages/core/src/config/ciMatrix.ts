import type { E2EConfig } from './schema.js';

/** One `e2e-mock` job: a platform version and a Playwright shard. */
export interface CiMatrixEntry {
  ps: string;
  /** Playwright's `--shard` value, e.g. `1/2`. */
  shard: string;
  shardIndex: number;
}

export interface CiMatrix {
  moduleName: string;
  shards: number;
  mock: CiMatrixEntry[];
  sandbox: { ps: string }[];
  sandboxEnabled: boolean;
  sandboxBlocking: boolean;
  /**
   * Secret names the sandbox jobs need. Deliberately **empty when sandbox is off**: the reusable
   * workflow forwards exactly this list, and spec §11 requires mock jobs to run with zero provider
   * secrets present. Emitting names for a disabled sandbox would be the first step toward leaking
   * them into a mock job.
   */
  requiredSecrets: string[];
}

/**
 * Derive the CI job matrix from a validated config (spec §8.1).
 *
 * Pure by design — the reusable workflow's `prepare` job shells out to `e2e-kit ci-matrix`, and this
 * function is what that command prints. Keeping it free of I/O is what makes the matrix testable
 * without booting Docker.
 *
 * Sandbox expands over platform versions only, never over shards: a sandbox run talks to a real
 * provider, and sharding it multiplies external calls without improving coverage (spec §8.1).
 */
export function ciMatrix(config: E2EConfig): CiMatrix {
  const shards = config.ci.shards;
  const versions = config.platform.versions;

  const mock: CiMatrixEntry[] = [];
  for (const ps of versions) {
    for (let i = 1; i <= shards; i++) {
      mock.push({ ps, shard: `${i}/${shards}`, shardIndex: i });
    }
  }

  const sandboxEnabled = config.psp?.sandbox.enabled === true;

  return {
    moduleName: config.module.name,
    shards,
    mock,
    sandbox: sandboxEnabled ? versions.map((ps) => ({ ps })) : [],
    sandboxEnabled,
    sandboxBlocking: config.psp?.sandbox.blocking ?? false,
    requiredSecrets: sandboxEnabled ? config.psp!.sandbox.requiredSecrets : [],
  };
}
