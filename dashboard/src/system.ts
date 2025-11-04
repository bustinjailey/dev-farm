import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import Docker from 'dockerode';
import { HOST_REPO_PATH } from './config.js';
import { loadRegistry, saveRegistry } from './registry.js';
import type { RegistryMap, EnvironmentRecord } from './types.js';
import { getWorkspacePath } from './env-utils.js';

const execFile = promisify(execFileCb);

export interface SystemStatusInfo {
  docker_connected: boolean;
  environments: number;
  updates_available: boolean;
  commits_behind: number;
  current_sha: string;
  latest_sha: string;
}

export interface OrphanInfo {
  id: string;
  name: string;
  status: string;
  created: string;
}

export async function getSystemStatus(docker: Docker | null): Promise<SystemStatusInfo> {
  const registry = await loadRegistry();
  const result: SystemStatusInfo = {
    docker_connected: Boolean(docker),
    environments: Object.keys(registry).length,
    updates_available: false,
    commits_behind: 0,
    current_sha: '',
    latest_sha: '',
  };

  try {
    const { stdout: currentSha } = await execFile('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: HOST_REPO_PATH,
    });
    result.current_sha = currentSha.trim();
  } catch {}

  try {
    await execFile('git', ['fetch', 'origin', 'main'], { cwd: HOST_REPO_PATH });
    const { stdout: latestSha } = await execFile('git', ['rev-parse', '--short', 'origin/main'], {
      cwd: HOST_REPO_PATH,
    });
    result.latest_sha = latestSha.trim();

    const { stdout: behind } = await execFile('git', ['rev-list', '--count', 'HEAD..origin/main'], {
      cwd: HOST_REPO_PATH,
    });
    result.commits_behind = Number.parseInt(behind.trim(), 10) || 0;
    result.updates_available = result.commits_behind > 0;
  } catch {}

  return result;
}

export async function listOrphans(docker: Docker): Promise<{ orphans: OrphanInfo[]; tracked: number }> {
  const registry = await loadRegistry();
  const trackedIds = new Set(
    Object.values(registry).map((env) => (env as any).containerId ?? (env as any).container_id)
  );
  const containers = await docker.listContainers({ all: true, filters: { label: ['dev-farm=true'] } });

  const orphans: OrphanInfo[] = containers
    .filter((container) => !trackedIds.has(container.Id))
    .map((container) => ({
      id: container.Id,
      name: container.Names?.[0] ?? container.Id,
      status: container.Status ?? 'unknown',
      created: new Date(container.Created * 1000).toISOString(),
    }));

  return { orphans, tracked: Object.keys(registry).length };
}

export async function cleanupOrphans(docker: Docker): Promise<{ cleaned: string[]; errors: Record<string, string> }> {
  const { orphans } = await listOrphans(docker);
  const cleaned: string[] = [];
  const errors: Record<string, string> = {};

  for (const orphan of orphans) {
    try {
      const container = docker.getContainer(orphan.id);
      await container.stop().catch(() => {});
      await container.remove({ force: true });
      cleaned.push(orphan.id);
    } catch (error) {
      errors[orphan.id] = (error as Error).message;
    }
  }

  return { cleaned, errors };
}

export async function recoverRegistry(docker: Docker): Promise<{ restored: number }> {
  const containers = await docker.listContainers({ all: true, filters: { label: ['dev-farm=true'] } });
  const registry: RegistryMap = {};

  for (const info of containers) {
    try {
      const container = docker.getContainer(info.Id);
      const inspect = await container.inspect();
      const envId = inspect.Config.Labels['dev-farm.id'] ?? info.Id;
      const mode = (inspect.Config.Labels['dev-farm.mode'] ?? 'workspace') as EnvironmentRecord['mode'];
      const workspacePath = await getWorkspacePath(mode);

      registry[envId] = {
        name: inspect.Config.Labels['dev-farm.name'] ?? envId,
        displayName: inspect.Config.Labels['dev-farm.name'] ?? envId,
        envId,
        containerId: info.Id,
        port: 0,
        created: new Date(inspect.Created).toISOString(),
        project: inspect.Config.Labels['dev-farm.project'] ?? 'general',
        mode,
        sshHost: null,
        sshUser: null,
        sshPath: null,
        sshPassword: null,
        sshAlias: null,
        gitUrl: null,
        parentEnvId: null,
        creatorType: 'user',
        creatorName: inspect.Config.Labels['dev-farm.creator'] ?? 'Unknown',
        creatorEnvId: null,
        creationSource: inspect.Config.Labels['dev-farm.source'] ?? 'recovered',
        children: [],
      };

      // include workspace path in label for UI
    } catch {
      /* ignore */
    }
  }

  await saveRegistry(registry);
  return { restored: Object.keys(registry).length };
}

export async function getContainerLogs(docker: Docker, name: string, lines = 200): Promise<string> {
  const container = docker.getContainer(name);
  const stream = await container.logs({ tail: lines, stdout: true, stderr: true });
  if (Buffer.isBuffer(stream)) {
    return stream.toString('utf-8');
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = stream as unknown as NodeJS.ReadableStream;
    readable.on('data', (chunk: Buffer) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    readable.on('error', reject);
  });
}

export async function upgradeSystem(): Promise<{ success: boolean; output: string; error?: string | null }> {
  try {
    const { stdout, stderr } = await execFile('/bin/bash', ['/opt/scripts/upgrade.sh'], { timeout: 300000 });
    if (stderr?.trim()) {
      return { success: false, output: stdout, error: stderr };
    }
    return { success: true, output: stdout };
  } catch (error) {
    if ((error as any).code === 'ETIMEDOUT') {
      return { success: false, output: '', error: 'Upgrade timed out' };
    }
    return { success: false, output: '', error: (error as Error).message };
  }
}

export async function getEnvironmentHierarchy(docker: Docker | null) {
  const registry = await loadRegistry();

  const buildTree = async (envId: string): Promise<any | null> => {
    const env = registry[envId] as any;
    if (!env) return null;

    let status = 'unknown';
    if (docker) {
      try {
        const container = docker.getContainer(env.container_id);
        const inspect = await container.inspect();
        status = inspect.State?.Status ?? 'unknown';
      } catch {
        status = 'unknown';
      }
    }

    const childTrees = [] as any[];
    for (const childId of env.children ?? []) {
      const child = await buildTree(childId);
      if (child) childTrees.push(child);
    }

    return {
      id: envId,
      name: env.displayName ?? env.name,
      creator: env.creatorName ?? env.creator_name ?? 'Unknown',
      creator_type: env.creatorType ?? env.creator_type ?? 'user',
      status,
      children: childTrees,
    };
  };

  const roots = Object.entries(registry as Record<string, any>)
    .filter(([, env]) => !env.parentEnvId && !env.parent_env_id)
    .map(([envId]) => envId);

  const trees: any[] = [];
  for (const root of roots) {
    const tree = await buildTree(root);
    if (tree) trees.push(tree);
  }

  return { trees };
}

export async function listImages(docker: Docker): Promise<
  { name: string; tag: string; size: number; created: string }[]
> {
  const images = await docker.listImages({ filters: { reference: ['dev-farm*'] } });
  const results: { name: string; tag: string; size: number; created: string }[] = [];

  for (const image of images) {
    for (const tag of image.RepoTags ?? ['<none>:<none>']) {
      const [name, tagName] = tag.split(':');
      results.push({
        name,
        tag: tagName ?? 'latest',
        size: image.Size,
        created: new Date((image.Created ?? 0) * 1000).toISOString(),
      });
    }
  }

  return results;
}

export async function buildImage(docker: Docker, imageType: 'code-server' | 'terminal' | 'dashboard') {
  const updater = await ensureUpdaterContainer(docker);
  let command: string;

  if (imageType === 'code-server') {
    command = `docker build --no-cache -t dev-farm/code-server:latest -f ${HOST_REPO_PATH}/docker/Dockerfile.code-server ${HOST_REPO_PATH}/docker`;
  } else if (imageType === 'terminal') {
    command = `docker compose -f ${HOST_REPO_PATH}/docker-compose.yml build --no-cache terminal-builder`;
  } else if (imageType === 'dashboard') {
    command = `docker build --no-cache -t dev-farm-dashboard:latest ${HOST_REPO_PATH}/dashboard`;
  } else {
    throw new Error(`Unsupported image type: ${imageType}`);
  }

  const result = await runCommandInContainer(updater, command);
  return result;
}

export async function ensureUpdaterContainer(docker: Docker) {
  try {
    const container = docker.getContainer('devfarm-updater');
    const inspect = await container.inspect();
    if (inspect.State?.Running !== true) {
      await container.start();
    }
    return container;
  } catch (error) {
    if ((error as any).statusCode !== 404) {
      throw error;
    }

    const container = await docker.createContainer({
      Image: 'docker:27-cli',
      name: 'devfarm-updater',
      Cmd: ['tail', '-f', '/dev/null'],
      HostConfig: {
        Binds: [
          '/var/run/docker.sock:/var/run/docker.sock',
          `${HOST_REPO_PATH}:${HOST_REPO_PATH}`,
        ],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });

    await container.start();
    return container;
  }
}

export async function runCommandInContainer(container: Docker.Container, command: string) {
  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({ hijack: true, stdin: false });
  const output = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });

  const inspect = await exec.inspect();
  return { success: inspect.ExitCode === 0, output, exitCode: inspect.ExitCode ?? 0 };
}
