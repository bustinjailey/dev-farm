import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import type { FastifyInstance } from 'fastify';

class FakeExec {
  async start() {
    return { output: Buffer.from('') };
  }
}

class FakeContainer {
  constructor(public id: string, public name: string) { }

  async inspect() {
    return { State: { Status: 'running' } };
  }

  async start() { }

  async stop() { }

  async remove() { }

  async restart() { }

  async stats() {
    return {
      cpu_stats: {
        cpu_usage: { total_usage: 10 },
        system_cpu_usage: 100,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 5 },
        system_cpu_usage: 50,
      },
      memory_stats: { usage: 100, limit: 1024 },
    };
  }

  async exec() {
    return new FakeExec();
  }
}

class FakeDocker {
  containersById = new Map<string, FakeContainer>();
  containersByName = new Map<string, FakeContainer>();

  async listContainers() {
    return Array.from(this.containersById.values()).map((container) => ({
      Id: container.id,
      Names: [container.name],
      Status: 'running',
      Labels: {
        'dev-farm': 'true',
      },
    }));
  }

  getImage() {
    return {
      inspect: async () => ({}),
    };
  }

  getContainer(id: string) {
    const container = this.containersById.get(id) ?? this.containersByName.get(id);
    if (!container) {
      throw Object.assign(new Error('Not Found'), { statusCode: 404 });
    }
    return container;
  }

  async createContainer(opts: { name: string }) {
    const id = `id-${Math.random().toString(36).slice(2, 8)}`;
    const container = new FakeContainer(id, opts.name);
    this.containersById.set(id, container);
    this.containersByName.set(opts.name, container);
    return container;
  }

  getVolume() {
    return {
      remove: async () => { },
    };
  }
}

const dockerStub = new FakeDocker();

vi.mock('./docker.js', () => ({
  getDocker: () => dockerStub,
}));

vi.mock('child_process', () => ({
  execFile: (cmd: any, args: any, opts: any, cb: any) => {
    const callback = typeof opts === 'function' ? opts : typeof args === 'function' ? args : cb;
    if (callback) {
      callback(null, { stdout: 'mock\n', stderr: '' });
    }
    return {} as any;
  },
}));

let tmpDir: string;
let server: FastifyInstance;
let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(async () => {
  dockerStub.containersById.clear();
  dockerStub.containersByName.clear();
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'devfarm-test-'));
  process.env.REGISTRY_FILE = path.join(tmpDir, 'registry.json');
  process.env.DEVFARM_ALIAS_CONFIG = path.join(tmpDir, 'aliases.json');
  process.env.GITHUB_TOKEN_FILE = path.join(tmpDir, 'token.txt');
  process.env.DEVICE_CODE_FILE = path.join(tmpDir, 'device.json');
  writeFileSync(process.env.GITHUB_TOKEN_FILE, 'test-token');
  vi.resetModules();
  const module = await import('./server.js');
  server = await module.buildServer({ enableBackgroundJobs: false, logger: false });
});

afterEach(async () => {
  await server.close();
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('environment API', () => {
  it('returns empty list when no environments registered', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/environments' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('creates a workspace environment', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/create',
      payload: { name: 'Test Env', mode: 'workspace' },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({ success: true, env_id: 'test-env' });

    const listResponse = await server.inject({ method: 'GET', url: '/api/environments' });
    const body = listResponse.json() as any[];
    expect(listResponse.statusCode).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 'test-env',
      mode: 'workspace',
      desktopCommand: expect.stringContaining('code-insiders'),
    });
  });
});

describe('github API', () => {
  it('reports unauthenticated when token missing', async () => {
    const tokenPath = path.join(tmpDir, 'token.txt');
    if (existsSync(tokenPath)) {
      rmSync(tokenPath);
    }
    const response = await server.inject({ method: 'GET', url: '/api/github/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: false });
  });

  it('returns status from GitHub when token valid', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    fetchSpy
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ login: 'test-user' }), {
          status: 200,
          headers: { 'x-oauth-scopes': 'repo, read:user' },
        })
      )
      .mockImplementationOnce(async () => new Response('{}', { status: 200 }));

    const response = await server.inject({ method: 'GET', url: '/api/github/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ authenticated: true, username: 'test-user' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('lists repositories when token valid', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    fetchSpy
      .mockImplementationOnce(async () => new Response('{}', { status: 200 }))
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify([
            {
              full_name: 'owner/repo',
              ssh_url: 'git@github.com:owner/repo.git',
              clone_url: 'https://github.com/owner/repo.git',
              description: 'demo',
              private: true,
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]),
          { status: 200 }
        )
      );

    const response = await server.inject({ method: 'GET', url: '/api/github/repos' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({ name: 'owner/repo', private: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns github config defaults', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/config/github' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: '', email: '' });
  });

  it('rejects invalid PAT format', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/config/github',
      payload: { personal_access_token: 'badtoken' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('starts github device flow', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
    fetchSpy.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          device_code: 'device123',
          user_code: 'CODE-123',
          verification_uri: 'https://github.com/device',
          expires_in: 600,
          interval: 5,
        }),
        { status: 200 }
      )
    );

    const response = await server.inject({ method: 'POST', url: '/api/github/auth/start' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user_code: 'CODE-123' });
  });
});

describe('system API', () => {
  it('returns system status payload', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/system/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('docker_connected');
  });
});
