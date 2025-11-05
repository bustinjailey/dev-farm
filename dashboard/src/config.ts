// =============================================================================
// DEPLOYMENT CONFIGURATION
// These are set via environment variables in docker-compose.yml or for testing.
// Most users should NOT need to change these.
// =============================================================================

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Data directory: where runtime files (registry, tokens) are stored
// Production: /data (Docker volume)
// Development: ./data (local directory)
const DATA_DIR = process.env.DATA_DIR || (IS_PRODUCTION ? '/data' : './data');

// Repo path: where Dev Farm source code is installed
// Production: /opt/dev-farm (LXC/server installation)
// Development: current working directory
const REPO_PATH = process.env.HOST_REPO_PATH || (IS_PRODUCTION ? '/opt/dev-farm' : process.cwd());

// Runtime state files (generated, not user-configured)
export const REGISTRY_FILE = `${DATA_DIR}/environments.json`;
export const GITHUB_TOKEN_FILE = `${DATA_DIR}/.github_token`;
export const DEVICE_CODE_FILE = `${DATA_DIR}/.device_code.json`;

// User configuration file (secrets, preferences)
export const FARM_CONFIG_FILE = `${REPO_PATH}/farm-config.json`;

// External URL for link generation (set in docker-compose.yml)
export const EXTERNAL_URL = (process.env.EXTERNAL_URL || 'http://localhost:5000').replace(/\/$/, '');

// =============================================================================
// FIXED CONSTANTS
// These never change and are not configurable.
// =============================================================================

// Starting port for environment assignment (8100, 8101, 8102, ...)
export const BASE_PORT = 8100;

// Workspace paths inside containers (fixed by Dockerfile)
export const WORKSPACE_PATHS = {
  workspace: '/workspace',
  git: '/repo',
  ssh: '/workspace',
  terminal: '/workspace',
} as const;
