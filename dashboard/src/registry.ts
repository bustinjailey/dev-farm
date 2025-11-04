import { promises as fs } from 'fs';
import { BASE_PORT, REGISTRY_FILE } from './config.js';
import { readJsonFile, writeJsonFile } from './file-utils.js';
import type { EnvironmentRecord, RegistryMap } from './types.js';

export async function loadRegistry(): Promise<RegistryMap> {
  return readJsonFile<RegistryMap>(REGISTRY_FILE, {});
}

export async function saveRegistry(registry: RegistryMap): Promise<void> {
  await writeJsonFile(REGISTRY_FILE, registry);
}

export async function getNextPort(): Promise<number> {
  const registry = await loadRegistry();
  const used = new Set(Object.values(registry).map((env) => env.port));
  let port = BASE_PORT;
  while (used.has(port)) {
    port += 1;
  }
  return port;
}

export async function upsertEnvironment(env: EnvironmentRecord): Promise<void> {
  const registry = await loadRegistry();
  registry[env.envId] = env;
  await saveRegistry(registry);
}

export async function removeEnvironment(envId: string): Promise<void> {
  const registry = await loadRegistry();
  if (registry[envId]) {
    delete registry[envId];
    // Remove child references pointing to this env
    for (const record of Object.values(registry)) {
      if (record.children?.includes(envId)) {
        record.children = record.children.filter((child) => child !== envId);
      }
    }
    await saveRegistry(registry);
  }
}

export async function syncRegistryWithDocker(listContainers: () => Promise<string[]>): Promise<void> {
  const registry = await loadRegistry();
  const existing = new Set(await listContainers());
  let updated = false;
  for (const [envId, record] of Object.entries(registry)) {
    if (!existing.has(record.containerId)) {
      delete registry[envId];
      updated = true;
    }
  }
  if (updated) {
    await saveRegistry(registry);
  }
}

export async function readEnvironment(envId: string): Promise<EnvironmentRecord | null> {
  const registry = await loadRegistry();
  return registry[envId] ?? null;
}

