import { promises as fs } from 'fs';
import path from 'path';
import {
  FARM_CONFIG_FILE,
  PATH_ALIAS_CONFIG,
  EXTERNAL_URL,
  GITHUB_TOKEN_FILE,
  DEVICE_CODE_FILE,
} from './config.js';

interface FarmConfig {
  github?: {
    personal_access_token?: string;
    username?: string;
    email?: string;
  };
  mcp?: {
    api_keys?: Record<string, string>;
  };
}

let aliasCache: Record<string, string> | null = null;
let farmConfigCache: FarmConfig | null = null;

export function kebabify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export async function loadPathAliases(): Promise<Record<string, string>> {
  if (aliasCache) {
    return aliasCache;
  }
  try {
    const raw = await fs.readFile(PATH_ALIAS_CONFIG, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      aliasCache = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string') as [string, string][]
      );
      return aliasCache;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[Paths] Failed to load ${PATH_ALIAS_CONFIG}:`, error);
    }
  }
  aliasCache = {};
  return aliasCache;
}

export async function getWorkspacePath(mode: string): Promise<string> {
  const aliasMap = await loadPathAliases();
  const lookup: Record<string, [string, string]> = {
    git: ['repo', '/repo'],
    workspace: ['workspace', '/workspace'],
    ssh: ['workspace', '/workspace'],
    terminal: ['workspace', '/workspace'],
  };

  const entry = lookup[mode] ?? lookup.workspace;
  const alias = aliasMap[entry[0]];
  return alias ?? entry[1];
}

export async function loadFarmConfig(): Promise<FarmConfig> {
  if (farmConfigCache) {
    return farmConfigCache;
  }
  try {
    const raw = await fs.readFile(FARM_CONFIG_FILE, 'utf-8');
    farmConfigCache = JSON.parse(raw) as FarmConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[Config] Error loading farm.config:`, error);
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
  await fs.chmod(GITHUB_TOKEN_FILE, 0o600).catch(() => {});
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
  if (!workspacePath) {
    return `https://insiders.vscode.dev/tunnel/${envId}`;
  }
  const sanitized = workspacePath.replace(/^\/+/, '');
  if (!sanitized) {
    return `https://insiders.vscode.dev/tunnel/${envId}`;
  }
  const encoded = encodeURIComponent(`/${sanitized}`);
  return `https://insiders.vscode.dev/tunnel/${envId}?folder=${encoded}`;
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
  aliasCache = null;
  farmConfigCache = null;
}
