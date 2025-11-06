import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import * as github from './github.js';

let tmpDir: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'github-test-'));
  vi.resetModules();
  vi.stubEnv('DATA_DIR', tmpDir);
  vi.stubEnv('HOST_REPO_PATH', tmpDir);

  // Create farm-config.json
  await fs.writeFile(
    path.join(tmpDir, 'farm-config.json'),
    JSON.stringify({ github: { username: 'testuser', email: 'test@example.com' } })
  );

  fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
});

afterEach(async () => {
  fetchSpy.mockRestore();
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getGithubStatus', () => {
  it('returns unauthenticated when no token exists', async () => {
    const status = await github.getGithubStatus();

    expect(status.authenticated).toBe(false);
    expect(status.message).toContain('No GitHub token found');
  });

  it('detects valid token with full access', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'valid-token');

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'testuser' }), {
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'repo, read:org' }),
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const status = await github.getGithubStatus();

    expect(status.authenticated).toBe(true);
    expect(status.username).toBe('testuser');
    expect(status.has_required_scopes).toBe(true);
    expect(status.can_access_private_repos).toBe(true);
    expect(status.needs_reauth).toBe(false);
  });

  it('detects token with missing scopes', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'limited-token');

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'testuser' }), {
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'read:user' }),
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));

    const status = await github.getGithubStatus();

    expect(status.authenticated).toBe(true);
    expect(status.has_required_scopes).toBe(false);
    expect(status.can_access_private_repos).toBe(false);
    expect(status.needs_reauth).toBe(true);
    expect(status.message).toContain('missing required scopes');
  });

  it('handles expired/invalid token', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'expired-token');

    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const status = await github.getGithubStatus();

    expect(status.authenticated).toBe(false);
    expect(status.needs_reauth).toBe(true);
    expect(status.message).toContain('invalid or expired');
  });

  it('detects PAT vs OAuth token', async () => {
    const config = { github: { personal_access_token: 'ghp_test', username: 'user', email: 'e@e.com' } };
    await fs.writeFile(path.join(tmpDir, 'farm-config.json'), JSON.stringify(config));

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'user' }), {
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'repo' }),
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const status = await github.getGithubStatus();

    expect(status.using_pat).toBe(true);
  });

  it('handles network errors gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'token');

    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const status = await github.getGithubStatus();

    expect(status.authenticated).toBe(false);
    expect(status.message).toContain('Network error');
  });
});

describe('listGithubRepos', () => {
  it('returns error when no token configured', async () => {
    const result = await github.listGithubRepos();

    expect(result).toEqual({ error: 'GitHub token not configured' });
  });

  it('fetches repositories successfully', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'valid-token');

    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // User check
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              full_name: 'user/repo1',
              ssh_url: 'git@github.com:user/repo1.git',
              clone_url: 'https://github.com/user/repo1.git',
              description: 'Test repo',
              private: false,
              updated_at: '2024-01-01T00:00:00Z',
            },
            {
              full_name: 'user/repo2',
              ssh_url: 'git@github.com:user/repo2.git',
              clone_url: 'https://github.com/user/repo2.git',
              description: null,
              private: true,
              updated_at: '2024-01-02T00:00:00Z',
            },
          ]),
          { status: 200 }
        )
      );

    const result = await github.listGithubRepos();

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        name: 'user/repo1',
        ssh_url: 'git@github.com:user/repo1.git',
        https_url: 'https://github.com/user/repo1.git',
        description: 'Test repo',
        private: false,
      });
      expect(result[1]).toMatchObject({
        name: 'user/repo2',
        private: true,
        description: null,
      });
    }
  });

  it('detects expired token', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'expired-token');

    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const result = await github.listGithubRepos();

    expect(result).toMatchObject({
      error: 'Token is invalid or expired',
      needs_reauth: true,
    });
  });

  it('handles API errors', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'token');

    fetchSpy
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

    const result = await github.listGithubRepos();

    expect(result).toMatchObject({
      error: 'Failed to fetch repositories: 500',
    });
  });
});

describe('getGithubConfig', () => {
  it('returns config with PAT indicator', async () => {
    const config = {
      github: {
        personal_access_token: 'ghp_secret',
        username: 'testuser',
        email: 'test@example.com',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'farm-config.json'), JSON.stringify(config));

    const result = await github.getGithubConfig();

    expect(result).toEqual({
      has_pat: true,
      username: 'testuser',
      email: 'test@example.com',
    });
  });

  it('returns empty config when not set', async () => {
    await fs.writeFile(path.join(tmpDir, 'farm-config.json'), JSON.stringify({}));

    const result = await github.getGithubConfig();

    expect(result).toEqual({
      has_pat: false,
      username: '',
      email: '',
    });
  });
});

describe('updateGithubConfig', () => {
  it('validates PAT format', async () => {
    const result = await github.updateGithubConfig({ personal_access_token: 'invalid' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid token format');
  });

  it('accepts valid PAT formats', async () => {
    const result1 = await github.updateGithubConfig({ personal_access_token: 'ghp_validtoken123' });
    expect(result1.success).toBe(true);

    const result2 = await github.updateGithubConfig({ personal_access_token: 'github_pat_validtoken456' });
    expect(result2.success).toBe(true);
  });

  it('updates username and email', async () => {
    const result = await github.updateGithubConfig({
      username: 'newuser',
      email: 'new@example.com',
    });

    expect(result.success).toBe(true);

    const config = await github.getGithubConfig();
    expect(config.username).toBe('newuser');
    expect(config.email).toBe('new@example.com');
  });

  it('allows clearing PAT by setting empty string', async () => {
    await github.updateGithubConfig({ personal_access_token: 'ghp_test' });
    const result = await github.updateGithubConfig({ personal_access_token: '' });

    expect(result.success).toBe(true);

    const config = await github.getGithubConfig();
    expect(config.has_pat).toBe(false);
  });
});

describe('GitHub Device Flow', () => {
  it('starts device flow successfully', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: 'device123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200 }
      )
    );

    const result = await github.startGithubDeviceFlow();

    expect(result).toMatchObject({
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
    expect(result).not.toHaveProperty('error');

    // Verify device code was saved
    const deviceCodePath = path.join(tmpDir, '.github_device_code');
    const saved = await fs.readFile(deviceCodePath, 'utf-8');
    const parsed = JSON.parse(saved);
    expect(parsed.device_code).toBe('device123');
  });

  it('handles device flow API errors', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

    const result = await github.startGithubDeviceFlow();

    expect(result).toHaveProperty('error');
  });

  it('polls device flow - pending state', async () => {
    // First save a device code
    const deviceData = {
      device_code: 'device123',
      user_code: 'CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
      started_at: Date.now() / 1000,
    };
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), JSON.stringify(deviceData));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 })
    );

    const result = await github.pollGithubDeviceFlow();

    expect(result).toEqual({ status: 'pending' });
  });

  it('polls device flow - success', async () => {
    const deviceData = {
      device_code: 'device123',
      user_code: 'CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
      started_at: Date.now() / 1000,
    };
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), JSON.stringify(deviceData));

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'gho_newtoken123' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'testuser' }), { status: 200 })
      );

    const result = await github.pollGithubDeviceFlow();

    expect(result).toMatchObject({ status: 'success', username: 'testuser' });

    // Verify token was saved and device code was removed
    const tokenPath = path.join(tmpDir, '.github_token');
    const token = await fs.readFile(tokenPath, 'utf-8');
    expect(token).toBe('gho_newtoken123');

    const deviceCodePath = path.join(tmpDir, '.github_device_code');
    await expect(fs.access(deviceCodePath)).rejects.toThrow();
  });

  it('polls device flow - expired', async () => {
    const deviceData = {
      device_code: 'device123',
      user_code: 'CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 10,
      interval: 5,
      started_at: Date.now() / 1000 - 20, // Started 20 seconds ago, expires after 10
    };
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), JSON.stringify(deviceData));

    const result = await github.pollGithubDeviceFlow();

    expect(result).toEqual({ status: 'expired' });

    // Verify device code was removed
    const deviceCodePath = path.join(tmpDir, '.github_device_code');
    await expect(fs.access(deviceCodePath)).rejects.toThrow();
  });

  it('polls device flow - slow down', async () => {
    const deviceData = {
      device_code: 'device123',
      user_code: 'CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
      started_at: Date.now() / 1000,
    };
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), JSON.stringify(deviceData));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'slow_down' }), { status: 200 })
    );

    const result = await github.pollGithubDeviceFlow();

    expect(result).toMatchObject({
      status: 'slow_down',
      message: expect.stringContaining('increase interval'),
    });
  });

  it('polls device flow - access denied', async () => {
    const deviceData = {
      device_code: 'device123',
      user_code: 'CODE',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
      started_at: Date.now() / 1000,
    };
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), JSON.stringify(deviceData));

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'access_denied' }), { status: 200 })
    );

    const result = await github.pollGithubDeviceFlow();

    expect(result).toEqual({ status: 'denied' });
  });

  it('polls device flow - no flow in progress', async () => {
    const result = await github.pollGithubDeviceFlow();

    expect(result).toMatchObject({
      status: 'no_flow',
      message: 'No OAuth flow in progress',
    });
  });
});

describe('disconnectGithub', () => {
  it('removes token and device code files', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'token');
    await fs.writeFile(path.join(tmpDir, '.github_device_code'), '{}');

    await github.disconnectGithub();

    await expect(fs.access(path.join(tmpDir, '.github_token'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, '.github_device_code'))).rejects.toThrow();
  });
});

describe('logoutGithub', () => {
  it('clears token and returns success', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'token');

    const result = await github.logoutGithub();

    expect(result).toEqual({ success: true, message: 'Logged out successfully' });
    await expect(fs.access(path.join(tmpDir, '.github_token'))).rejects.toThrow();
  });
});

describe('getGithubAuthStatus', () => {
  it('returns authenticated status with user data', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'valid-token');

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          login: 'testuser',
          name: 'Test User',
          avatar_url: 'https://github.com/avatar.png',
        }),
        { status: 200 }
      )
    );

    const result = await github.getGithubAuthStatus();

    expect(result).toMatchObject({
      authenticated: true,
      username: 'testuser',
      name: 'Test User',
      avatar: 'https://github.com/avatar.png',
    });
  });

  it('returns unauthenticated when no token', async () => {
    const result = await github.getGithubAuthStatus();

    expect(result).toMatchObject({
      authenticated: false,
      message: 'No token configured',
    });
  });

  it('handles invalid token', async () => {
    await fs.writeFile(path.join(tmpDir, '.github_token'), 'invalid-token');

    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const result = await github.getGithubAuthStatus();

    expect(result).toMatchObject({
      authenticated: false,
      message: 'Invalid token',
    });
  });
});
