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
  vi.stubEnv('DATA_DIR', tmpDir); // Set DATA_DIR so config.ts computes correct paths
  vi.stubEnv('HOST_REPO_PATH', tmpDir);
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
  it('returns workspace paths for different modes', () => {
    expect(envUtils.getWorkspacePath('workspace')).toBe('/workspace');
    expect(envUtils.getWorkspacePath('git')).toBe('/repo');
    expect(envUtils.getWorkspacePath('ssh')).toBe('/workspace');
    expect(envUtils.getWorkspacePath('terminal')).toBe('/workspace');
    expect(envUtils.getWorkspacePath('unknown')).toBe('/workspace');
  });
});

describe('farm config + GitHub tokens', () => {
  it('saves and loads farm config with secure permissions', async () => {
    const configFile = path.join(tmpDir, 'farm-config.json');
    const config = { github: { personal_access_token: 'pat', username: 'user' } };
    await envUtils.saveFarmConfig(config);
    const loaded = await envUtils.loadFarmConfig();
    expect(loaded).toEqual(config);
    if (process.platform !== 'win32') {
      const stat = await fs.stat(configFile);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('loadGitHubToken prefers farm.config, then file, then env', async () => {
    // Clear process.env.GITHUB_TOKEN first to test priority correctly
    delete process.env.GITHUB_TOKEN;
    const tokenFile = path.join(tmpDir, '.github_token');

    // Test 1: farm-config takes priority over everything
    await envUtils.saveFarmConfig({ github: { personal_access_token: 'from-config' } });
    await fs.writeFile(tokenFile, 'from-file');
    process.env.GITHUB_TOKEN = 'from-env';
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-config');

    // Test 2: when farm-config has no PAT, file takes priority
    await envUtils.saveFarmConfig({ github: {} });
    delete process.env.GITHUB_TOKEN; // Clear env var so file is used
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-file');

    // Test 3: when no farm-config PAT and no file, env var is used
    await fs.rm(tokenFile, { force: true });
    process.env.GITHUB_TOKEN = 'from-env';
    envUtils.resetCaches();
    expect(await envUtils.loadGitHubToken()).toBe('from-env');
  });

  it('saveGitHubToken writes file and updates env', async () => {
    const tokenFile = path.join(tmpDir, '.github_token');
    await envUtils.saveGitHubToken('new-token');
    const file = await fs.readFile(tokenFile, 'utf-8');
    expect(file).toBe('new-token');
    expect(process.env.GITHUB_TOKEN).toBe('new-token');

    // Verify file has secure permissions (non-Windows only)
    if (process.platform !== 'win32') {
      const stat = await fs.stat(tokenFile);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it('clearGitHubToken removes file and clears PAT in config', async () => {
    const tokenFile = path.join(tmpDir, '.github_token');
    await envUtils.saveFarmConfig({ github: { personal_access_token: 'pat' } });
    await envUtils.saveGitHubToken('token');
    await envUtils.clearGitHubToken();
    const exists = await fs
      .stat(tokenFile)
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
