import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

let tmpDir: string;
let registry: typeof import('./registry.js');

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-test-'));
  vi.resetModules();
  vi.stubEnv('DATA_DIR', tmpDir); // Set DATA_DIR so config.ts computes correct paths
  vi.stubEnv('BASE_PORT', '9000');
  registry = await import('./registry.js');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('registry helpers', () => {
  it('loadRegistry returns empty map when file missing', async () => {
    // This test must run with pristine state - file should not exist yet
    expect(await registry.loadRegistry()).toEqual({});
  });

  it('saveRegistry persists data', async () => {
    const data = { env1: { port: 9000 } } as any;
    await registry.saveRegistry(data);
    const loaded = await registry.loadRegistry();
    expect(loaded).toEqual(data);
  });

  it('getNextPort skips used ports', async () => {
    await registry.saveRegistry({ env1: { port: 8100 } } as any);
    expect(await registry.getNextPort()).toBe(8101);
  });

  it('upsertEnvironment adds and readEnvironment fetches', async () => {
    const env = {
      name: 'Test',
      displayName: 'Test',
      envId: 'test',
      containerId: 'cid',
      port: 9000,
      created: new Date().toISOString(),
      mode: 'workspace',
      children: [],
    } as any;
    await registry.upsertEnvironment(env);
    const stored = await registry.readEnvironment('test');
    expect(stored).toMatchObject({ envId: 'test', containerId: 'cid' });
  });

  it('removeEnvironment deletes record and child references', async () => {
    await registry.saveRegistry({
      parent: { envId: 'parent', port: 9000, children: ['child'] },
      child: { envId: 'child', port: 9001, children: [] },
    } as any);
    await registry.removeEnvironment('child');
    const loaded = await registry.loadRegistry();
    expect(loaded.child).toBeUndefined();
    expect(loaded.parent.children).toEqual([]);
  });

  it('syncRegistryWithDocker prunes missing containers', async () => {
    await registry.saveRegistry({
      env1: { envId: 'env1', containerId: 'keep', port: 9000 },
      env2: { envId: 'env2', containerId: 'missing', port: 9001 },
    } as any);
    await registry.syncRegistryWithDocker(async () => ['keep']);
    const loaded = await registry.loadRegistry();
    expect(Object.keys(loaded)).toEqual(['env1']);
  });
});
