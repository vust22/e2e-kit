export {
  defineE2EConfig,
  E2EConfigSchema,
  E2EConfigError,
  SHARED_SUITES,
  type E2EConfig,
  type E2EConfigInput,
  type SharedSuite,
} from './schema.js';
export { loadE2EConfig, resolveConfigPath } from './loader.js';
export { ciMatrix, type CiMatrix, type CiMatrixEntry } from './ciMatrix.js';
