import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

let tmpDir: string;
let envUtils: typeof import('./env-utils.js');

async function loadModule() {
  envUtils = await import('./env-utils.js');
  envUtils.resetCaches();
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-utils-test-'));
  vi.resetModules();
  vi.stubEnv('HOST_REPO_PATH', tmpDir);
  vi.stubEnv('FARM_CONFIG_FILE', path.join(tmpDir, 'farm.config'));
  vi.stubEnv('GITHUB_TOKEN_FILE', path.join(tmpDir, 'github.token'));
  vi.stubEnv('DEVICE_CODE_FILE', path.join(tmpDir, 'device.json'));
  vi.stubEnv('DEVFARM_ALIAS_CONFIG', path.join(tmpDir, 'aliases.json'));
  await loadModule();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('kebabify', () => {
  it('converts mixed characters to kebab-case', () => {
    expect(envUtils.kebabify('My Cool Project')).toBe('my-cool-project');
    expect(envUtils.kebabify('Test_Env 123')).toBe('test-env-123');
    expect(envUtils.kebabify('---Already---')).toBe('already');
  });
});

describe('buildTunnelUrl', () => {
  it('builds base url without workspace path', () => {
    expect(envUtils.buildTunnelUrl('sample')).toBe('https://insiders.vscode.dev/tunnel/sample');
  });

  it('encodes workspace paths', () => {
    expect(envUtils.buildTunnelUrl('sample', '/workspace')).toBe(
      'https://insiders.vscode.dev/tunnel/sample?folder=%2Fworkspace'
    );
    expect(envUtils.buildTunnelUrl('sample', '/workspace/project')).toBe(
      'https://insiders.vscode.dev/tunnel/sample?folder=%2Fworkspace%2Fproject'
    );
  });
});

describe('buildDesktopCommand', () => {
  it('produces tunnel command without workspace path', () => {
    expect(envUtils.buildDesktopCommand('sample')).toBe(
      'code-insiders --folder-uri "vscode-remote://tunnel/sample"'
    );
  });

  it('adds sanitized workspace paths', () => {
    expect(envUtils.buildDesktopCommand('sample', '/workspace')).toBe(
      'code-insiders --folder-uri "vscode-remote://tunnel/sample/workspace"'
    );
    expect(envUtils.buildDesktopCommand('sample', 'workspace/project')).toBe(
      'code-insiders --folder-uri "vscode-remote://tunnel/sample/workspace/project"'
    );
  });
});

describe('getWorkspacePath', () => {
  it('returns defaults when aliases missing', async () => {
    expect(await envUtils.getWorkspacePath('workspace')).toBe('/workspace');
    expect(await envUtils.getWorkspacePath('git')).toBe('/repo');
    expect(await envUtils.getWorkspacePath('ssh')).toBe('/workspace');
    expect(await envUtils.getWorkspacePath('terminal')).toBe('/workspace');
    expect(await envUtils.getWorkspacePath('unknown')).toBe('/workspace');
  });

  it('uses alias mappings when available', async () => {
    const aliasFile = process.env.DEVFARM_ALIAS_CONFIG as string;
    await fs.writeFile(
      aliasFile,
      JSON.stringify({ workspace: '/custom/ws', repo: '/custom/repo', remote: '/custom/remote' })
    );
    envUtils.resetCaches();
    expect(await envUtils.getWorkspacePath('workspace')).toBe('/custom/ws');
    expect(await envUtils.getWorkspacePath('git')).toBe('/custom/repo');
    expect(await envUtils.getWorkspacePath('ssh')).toBe('/custom/ws');
  });
});

describe('farm config + GitHub tokens', () => {
  it('saves and loads farm config with secure permissions', async () => {
    const config = { github: { personal_access_token: 'pat', username: 'user' } };
    await envUtils.saveFarmConfig(config);
    const loaded = await envUtils.loadFarmConfig();
    expect(loaded).toEqual(config);
    if (process.platform !== 'win32') {
      const stat = await fs.stat(process.env.FARM_CONFIG_FILE as string);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('loadGitHubToken prefers farm.config, then file, then env', async () => {
    await envUtils.saveFarmConfig({ github: { personal_access_token: 'from-config' } });
    await fs.writeFile(process.env.GITHUB_TOKEN_FILE as string, 'from-file');
    process.env.GITHUB_TOKEN = 'from-env';
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-config');

    await envUtils.saveFarmConfig({ github: {} });
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-file');

    await fs.rm(process.env.GITHUB_TOKEN_FILE as string, { force: true });
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-env');
  });

  it('saveGitHubToken writes file and updates env', async () => {
    await envUtils.saveGitHubToken('new-token');
    const file = await fs.readFile(process.env.GITHUB_TOKEN_FILE as string, 'utf-8');
    expect(file).toBe('new-token');
    expect(process.env.GITHUB_TOKEN).toBe('new-token');
  });

  it('clearGitHubToken removes file and clears PAT in config', async () => {
    await envUtils.saveFarmConfig({ github: { personal_access_token: 'pat' } });
    await envUtils.saveGitHubToken('token');
    await envUtils.clearGitHubToken();
    const exists = await fs
      .stat(process.env.GITHUB_TOKEN_FILE as string)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
    const config = await envUtils.loadFarmConfig();
    expect(config.github?.personal_access_token).toBeUndefined();
  });
});

describe('device code helpers', () => {
  it('saves, loads, and removes device code data', async () => {
    const payload = {
      device_code: 'abc',
      user_code: 'user',
      verification_uri: 'https://example.com',
      expires_in: 600,
      interval: 5,
      started_at: Date.now() / 1000,
    };
    await envUtils.saveDeviceCode(payload);
    const loaded = await envUtils.loadDeviceCode();
    expect(loaded).toEqual(payload);
    await envUtils.removeDeviceCode();
    expect(await envUtils.loadDeviceCode()).toBeNull();
  });
});
