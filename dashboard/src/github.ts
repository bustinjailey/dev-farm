import {
  loadFarmConfig,
  loadGitHubToken,
  saveFarmConfig,
  saveGitHubToken,
  clearGitHubToken,
  saveDeviceCode,
  loadDeviceCode,
  removeDeviceCode,
  type DeviceCodeData,
} from './env-utils.js';
import { DEVICE_CODE_FILE } from './config.js';
import { promises as fs } from 'fs';

const DEFAULT_PRIVATE_REPO = process.env.GITHUB_PRIVATE_REPO || 'bustinjailey/aggregate-mcp-server';

interface GithubStatusResponse {
  authenticated: boolean;
  message?: string | null;
  needs_reauth?: boolean;
  username?: string;
  scopes?: string[];
  has_required_scopes?: boolean;
  can_access_private_repos?: boolean;
  using_pat?: boolean;
}

interface GithubRepoSummary {
  name: string;
  ssh_url: string;
  https_url: string;
  description: string | null;
  private: boolean;
  updated: string;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getGithubStatus(): Promise<GithubStatusResponse> {
  const token = await loadGitHubToken();
  const farmConfig = await loadFarmConfig();
  const usingPat = Boolean(farmConfig.github?.personal_access_token);

  if (!token) {
    return {
      authenticated: false,
      message: 'No GitHub token found. Please connect your GitHub account or set a PAT.',
    };
  }

  try {
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/json',
    };

    const userResp = await fetchWithTimeout('https://api.github.com/user', { headers });

    if (userResp.status === 401) {
      return {
        authenticated: false,
        message: 'Token is invalid or expired. Please reconnect your GitHub account.',
        needs_reauth: true,
      };
    }

    if (!userResp.ok) {
      return {
        authenticated: false,
        message: `GitHub API error: ${userResp.status}`,
      };
    }

    const userJson = (await userResp.json()) as { login?: string };
    const scopesHeader = userResp.headers.get('x-oauth-scopes') ?? '';
    const scopes = scopesHeader
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    const requiredScopes = new Set(['repo']);
    const hasRequiredScopes = Array.from(requiredScopes).every((scope) => scopes.includes(scope));

    const repoResp = await fetchWithTimeout(`https://api.github.com/repos/${DEFAULT_PRIVATE_REPO}`, { headers });
    const canAccessPrivate = repoResp.status === 200;

    const needsReauth = !hasRequiredScopes || !canAccessPrivate;

    return {
      authenticated: true,
      username: userJson.login,
      scopes,
      has_required_scopes: hasRequiredScopes,
      can_access_private_repos: canAccessPrivate,
      needs_reauth: needsReauth,
      using_pat: usingPat,
      message: needsReauth
        ? 'Token valid but missing required scopes. Please set a PAT in farm.config or reconnect.'
        : undefined,
    };
  } catch (error) {
    return {
      authenticated: false,
      message: `Error checking GitHub status: ${(error as Error).message}`,
    };
  }
}

export async function listGithubRepos(): Promise<GithubRepoSummary[] | { error: string; needs_reauth?: boolean }> {
  const token = await loadGitHubToken();
  if (!token) {
    return { error: 'GitHub token not configured' };
  }

  try {
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };

    const scopeCheck = await fetchWithTimeout('https://api.github.com/user', { headers }, 5000);
    if (scopeCheck.status === 401) {
      return {
        error: 'Token is invalid or expired',
        needs_reauth: true,
      };
    }

    const response = await fetchWithTimeout('https://api.github.com/user/repos', {
      headers,
      method: 'GET',
    });

    if (!response.ok) {
      return { error: `Failed to fetch repositories: ${response.status}` };
    }

    const repos = (await response.json()) as any[];
    return repos.map((repo) => ({
      name: repo.full_name,
      ssh_url: repo.ssh_url,
      https_url: repo.clone_url,
      description: repo.description,
      private: Boolean(repo.private),
      updated: repo.updated_at,
    }));
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function disconnectGithub(): Promise<void> {
  await clearGitHubToken();
  await removeDeviceCode();
}

export async function getGithubConfig() {
  const config = await loadFarmConfig();
  const github = config.github ?? {};
  return {
    has_pat: Boolean(github.personal_access_token),
    username: github.username ?? '',
    email: github.email ?? '',
  };
}

export async function updateGithubConfig(data: {
  personal_access_token?: string;
  username?: string;
  email?: string;
}) {
  const config = await loadFarmConfig();
  const github = config.github ?? {};

  if (data.personal_access_token !== undefined) {
    const pat = data.personal_access_token.trim();
    if (pat && !(pat.startsWith('ghp_') || pat.startsWith('github_pat_'))) {
      return { success: false, error: 'Invalid token format. Must start with ghp_ or github_pat_' };
    }
    github.personal_access_token = pat;
    // Don't write to .github_token file - PAT entered via UI stays in farm-config.json only
    // The .github_token file is only for OAuth device flow tokens
  }

  if (data.username !== undefined) {
    github.username = data.username.trim();
  }

  if (data.email !== undefined) {
    github.email = data.email.trim();
  }

  config.github = github;
  await saveFarmConfig(config);
  return { success: true };
}

export async function startGithubDeviceFlow() {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id: GITHUB_DEVICE_CLIENT_ID, scope: 'repo read:org gist workflow' }),
  });

  if (!response.ok) {
    return { error: 'Failed to start OAuth flow' };
  }

  const data = (await response.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval?: number;
  };

  const record: DeviceCodeData = {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in,
    interval: data.interval ?? 5,
    started_at: Date.now() / 1000,
  };

  await saveDeviceCode(record);

  return {
    user_code: record.user_code,
    verification_uri: record.verification_uri,
    expires_in: record.expires_in,
    interval: record.interval,
  };
}

export async function pollGithubDeviceFlow() {
  const deviceData = await loadDeviceCode();
  if (!deviceData) {
    return { status: 'no_flow', message: 'No OAuth flow in progress' };
  }

  const elapsed = Date.now() / 1000 - deviceData.started_at;
  if (elapsed > deviceData.expires_in) {
    await removeDeviceCode();
    return { status: 'expired' };
  }

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: GITHUB_DEVICE_CLIENT_ID,
      device_code: deviceData.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (!response.ok) {
    return { status: 'error', message: `HTTP ${response.status}` };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (typeof result.access_token === 'string') {
    await saveGitHubToken(result.access_token);
    await removeDeviceCode();

    const userResp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${result.access_token}` },
    });

    if (userResp.ok) {
      const userJson = await userResp.json();
      return { status: 'success', username: userJson.login };
    }

    return { status: 'success' };
  }

  const error = result.error as string | undefined;
  if (error === 'authorization_pending') {
    return { status: 'pending' };
  }
  if (error === 'slow_down') {
    return { status: 'slow_down', message: 'Polling too fast, increase interval by 5 seconds' };
  }
  if (error === 'expired_token') {
    await removeDeviceCode();
    return { status: 'expired' };
  }
  if (error === 'access_denied') {
    await removeDeviceCode();
    return { status: 'denied' };
  }

  return { status: 'error', message: (result.error_description as string) ?? (error ?? 'Unknown error') };
}

export async function logoutGithub() {
  await clearGitHubToken();
  await removeDeviceCode();
  return { success: true, message: 'Logged out successfully' };
}

export async function getGithubAuthStatus() {
  const token = await loadGitHubToken();
  if (!token) {
    return { authenticated: false, message: 'No token configured' };
  }

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        authenticated: true,
        username: data.login,
        name: data.name,
        avatar: data.avatar_url,
      };
    }

    return { authenticated: false, message: 'Invalid token' };
  } catch (error) {
    return { authenticated: false, message: (error as Error).message };
  }
}
const GITHUB_DEVICE_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Iv1.b507a08c87ecfe98';
