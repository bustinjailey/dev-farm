import { promises as fs } from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  FARM_CONFIG_FILE,
  EXTERNAL_URL,
  GITHUB_TOKEN_FILE,
  DEVICE_CODE_FILE,
  WORKSPACE_PATHS,
} from './config.js';

interface FarmConfig {
  version?: string;
  github?: {
    personal_access_token?: string;
    username?: string;
    email?: string;
  };
  mcp?: {
    env?: Record<string, string>;
  };
}

const farmConfigSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+$',
    },
    github: {
      type: 'object',
      properties: {
        personal_access_token: {
          type: 'string',
        },
        username: { type: 'string' },
        email: { type: 'string' },
      },
      additionalProperties: false,
    },
    mcp: {
      type: 'object',
      properties: {
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: true,
};

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateFarmConfig = ajv.compile(farmConfigSchema);

let farmConfigCache: FarmConfig | null = null;

export function kebabify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function getWorkspacePath(mode: string): string {
  return WORKSPACE_PATHS[mode as keyof typeof WORKSPACE_PATHS] ?? WORKSPACE_PATHS.workspace;
}

export async function loadFarmConfig(): Promise<FarmConfig> {
  if (farmConfigCache) {
    return farmConfigCache;
  }
  try {
    const raw = await fs.readFile(FARM_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as FarmConfig;

    // Validate against schema
    if (!validateFarmConfig(parsed)) {
      console.warn('[Config] farm-config.json validation errors:', ajv.errorsText(validateFarmConfig.errors));
      console.warn('[Config] Using config despite validation errors. Please fix the configuration.');
    }

    farmConfigCache = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[Config] Error loading farm-config.json:`, error);
    }
    farmConfigCache = {};
  }
  return farmConfigCache;
}

export async function saveFarmConfig(config: FarmConfig): Promise<void> {
  await fs.mkdir(path.dirname(FARM_CONFIG_FILE), { recursive: true });
  await fs.writeFile(FARM_CONFIG_FILE, JSON.stringify(config, null, 2));
  await fs.chmod(FARM_CONFIG_FILE, 0o600);
  farmConfigCache = config;
}

export async function loadGitHubToken(): Promise<string | null> {
  const farmConfig = await loadFarmConfig();
  const pat = farmConfig.github?.personal_access_token?.trim();
  if (pat) {
    return pat;
  }

  try {
    const raw = await fs.readFile(GITHUB_TOKEN_FILE, 'utf-8');
    const token = raw.trim();
    if (token) {
      return token;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[Config] Failed to load GitHub token file:', error);
    }
  }

  const envToken = process.env.GITHUB_TOKEN?.trim();
  return envToken || null;
}

export async function saveGitHubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  await fs.mkdir(path.dirname(GITHUB_TOKEN_FILE), { recursive: true });
  await fs.writeFile(GITHUB_TOKEN_FILE, trimmed, 'utf-8');
  await fs.chmod(GITHUB_TOKEN_FILE, 0o600).catch(() => { });
  process.env.GITHUB_TOKEN = trimmed;
}

export async function clearGitHubToken(): Promise<void> {
  await fs.rm(GITHUB_TOKEN_FILE, { force: true });
  delete process.env.GITHUB_TOKEN;
  const config = await loadFarmConfig();
  if (config.github) {
    delete config.github.personal_access_token;
    await saveFarmConfig(config);
  }
}

export interface DeviceCodeData {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  started_at: number;
}

export async function saveDeviceCode(data: DeviceCodeData): Promise<void> {
  await fs.mkdir(path.dirname(DEVICE_CODE_FILE), { recursive: true });
  await fs.writeFile(DEVICE_CODE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadDeviceCode(): Promise<DeviceCodeData | null> {
  try {
    const raw = await fs.readFile(DEVICE_CODE_FILE, 'utf-8');
    return JSON.parse(raw) as DeviceCodeData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function removeDeviceCode(): Promise<void> {
  await fs.rm(DEVICE_CODE_FILE, { force: true });
}

export function buildTunnelUrl(envId: string, workspacePath?: string): string {
  // Use vscode-insiders:// scheme to directly open the workspace
  if (!workspacePath || workspacePath === '/') {
    return `vscode-insiders://vscode-remote/tunnel/${envId}`;
  }
  // For workspace mode, open the workspace folder directly
  return `vscode-insiders://vscode-remote/tunnel/${envId}${workspacePath}`;
}

export function buildProxyUrl(envId: string, workspacePath?: string): string {
  const suffix = workspacePath ? `?folder=${encodeURIComponent(workspacePath)}` : '';
  return `${EXTERNAL_URL}/env/${envId}${suffix}`;
}

export function buildDesktopCommand(envId: string, workspacePath?: string): string {
  const sanitized = (workspacePath ?? '').replace(/^\/+/, '');
  const folderSuffix = sanitized ? `/${sanitized}` : '';
  const remoteUri = `vscode-remote://tunnel/${envId}${folderSuffix}`;
  return `code-insiders --folder-uri "${remoteUri}"`;
}

export function resetCaches(): void {
  farmConfigCache = null;
}
