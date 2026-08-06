import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * What `e2e-kit up` recorded about the running stack, so that `test`, `reset-db` and
 * `down` (and Playwright workers) can find it without re-deriving anything.
 */
export interface StackState {
  projectName: string;
  composeFiles: string[];
  platformType: string;
  platformVersion: string;
  mode: 'mock' | 'sandbox';
  shopUrl: string;
  shopContainer: string;
  dbContainer: string;
  adminPath: string;
  adminEmail: string;
  adminPassword: string;
  moduleName: string;
  /** Mock service base URL as reachable from the host, when the mock overlay is active. */
  mockBaseUrl?: string;
  startedAt: string;
}

export const STATE_DIR = '.e2e-kit';
export const STATE_FILE = 'state.json';

export function stateFilePath(cwd: string): string {
  return path.join(cwd, STATE_DIR, STATE_FILE);
}

export function writeStackState(cwd: string, state: StackState): void {
  const file = stateFilePath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function readStackState(cwd: string): StackState | null {
  const file = stateFilePath(cwd);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as StackState;
}

export function readStackStateOrThrow(cwd: string): StackState {
  const state = readStackState(cwd);
  if (!state) {
    throw new Error(
      `No running stack found (${stateFilePath(cwd)} is missing). Run \`e2e-kit up\` first.`,
    );
  }
  return state;
}

export function clearStackState(cwd: string): void {
  rmSync(path.join(cwd, STATE_DIR), { recursive: true, force: true });
}
