import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type Docker from 'dockerode';

import { getDocker } from './docker.js';
import {
  getNextPort,
  loadRegistry,
  removeEnvironment,
  upsertEnvironment,
  readEnvironment,
} from './registry.js';
import {
  buildDesktopCommand,
  buildTunnelUrl,
  getWorkspacePath,
  loadGitHubToken,
  loadFarmConfig,
  kebabify,
} from './env-utils.js';
import { sseChannel, sseHandler } from './sse.js';
import { getContainerStats, isContainerHealthy } from './docker-utils.js';
import { execToString } from './container-exec.js';
import type { EnvironmentRecord, EnvironmentSummary } from './types.js';
import {
  disconnectGithub,
  getGithubStatus,
  listGithubRepos,
  getGithubConfig,
  updateGithubConfig,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  logoutGithub,
  getGithubAuthStatus,
} from './github.js';
import {
  getSystemStatus,
  listOrphans,
  cleanupOrphans,
  recoverRegistry,
  getContainerLogs,
  listImages,
  buildImage,
  upgradeSystem,
  getEnvironmentHierarchy,
} from './system.js';
import { startSystemUpdate, getUpdateStatus } from './system-update.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When running from compiled code (dist/server), __dirname will be dist/server
// When running from source (src), __dirname will be src
const distClientRoot = path.join(__dirname, '..', 'client');
const builtClientRoot = path.join(__dirname, '..', 'dist', 'client');
const devFallbackRoot = path.resolve(process.cwd(), 'frontend', 'public');

let clientRoot: string | null = null;
if (fs.existsSync(distClientRoot)) {
  // Running from compiled code (dist/server)
  clientRoot = distClientRoot;
} else if (fs.existsSync(builtClientRoot)) {
  // Running from source (src) but client is built
  clientRoot = builtClientRoot;
} else if (fs.existsSync(devFallbackRoot)) {
  // Fallback to dev public folder (only if it exists)
  clientRoot = devFallbackRoot;
}

interface ServerOptions {
  enableBackgroundJobs?: boolean;
  logger?: FastifyServerOptions['logger'];
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const { enableBackgroundJobs = true, logger = true } = options;
  const fastify = Fastify({ logger });

  await fastify.register(cors, { origin: true });

  // Only serve static files if client root exists (production mode)
  if (clientRoot) {
    await fastify.register(fastifyStatic, {
      root: clientRoot,
      prefix: '/',
    });
  }

  fastify.get('/api/stream', sseHandler);

  const docker = getDocker();
  const lastKnownStatus = new Map<string, string>();
  const aiSessions = new Map<string, { active: boolean; tool: 'aider' | 'copilot'; sessionId: string }>();
  const aiOutputCache = new Map<string, string>();

  async function getEnvironmentSummaries(): Promise<EnvironmentSummary[]> {
    const registry = await loadRegistry();
    const summaries: EnvironmentSummary[] = [];

    for (const [envId, env] of Object.entries(registry)) {
      try {
        const container = docker.getContainer(env.containerId);
        const inspect = await container.inspect();
        const status = inspect.State?.Status ?? 'unknown';
        const ready = await isContainerHealthy(container);
        const displayStatus = ready ? 'running' : status === 'running' ? 'starting' : status;
        const workspacePath = getWorkspacePath(env.mode);
        summaries.push({
          name: env.displayName ?? env.name,
          id: envId,
          port: env.port,
          status: displayStatus,
          ready,
          url: buildTunnelUrl(envId, workspacePath),
          desktopCommand: buildDesktopCommand(envId, workspacePath),
          workspacePath,
          mode: env.mode,
        });
      } catch (error) {
        fastify.log.warn({ envId, err: error }, 'Failed to inspect container');
      }
    }

    return summaries;
  }

  fastify.get('/api/environments', async () => {
    return getEnvironmentSummaries();
  });

  fastify.get('/api/github/status', async (_request, reply) => {
    const status = await getGithubStatus();
    if (!status.authenticated && status.message?.startsWith('Error')) {
      return reply.code(500).send(status);
    }
    return reply.send(status);
  });

  fastify.get('/api/github/repos', async (_request, reply) => {
    const result = await listGithubRepos();
    if (Array.isArray(result)) {
      return reply.send(result);
    }
    const statusCode = result.needs_reauth ? 401 : 500;
    return reply.code(statusCode).send(result);
  });

  fastify.post('/api/github/disconnect', async (_request, reply) => {
    try {
      await disconnectGithub();
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(500).send({ success: false, error: (error as Error).message });
    }
  });

  fastify.route({
    method: 'GET',
    url: '/api/config/github',
    handler: async (_request, reply) => reply.send(await getGithubConfig()),
  });

  fastify.route({
    method: 'POST',
    url: '/api/config/github',
    handler: async (request, reply) => {
      const body = (request.body as Record<string, string | undefined>) ?? {};
      const result = await updateGithubConfig({
        personal_access_token: body.personal_access_token,
        username: body.username,
        email: body.email,
      });
      if (!result.success) {
        return reply.code(400).send(result);
      }
      return reply.send(result);
    },
  });

  fastify.post('/api/github/auth/start', async (_request, reply) => {
    const result = await startGithubDeviceFlow();
    const status = 'error' in result ? 500 : 200;
    return reply.code(status).send(result);
  });

  fastify.post('/api/github/auth/poll', async (_request, reply) => {
    const result = await pollGithubDeviceFlow();
    if (result.status === 'error') {
      return reply.code(500).send(result);
    }
    return reply.send(result);
  });

  fastify.post('/api/github/auth/logout', async (_request, reply) => {
    try {
      return reply.send(await logoutGithub());
    } catch (error) {
      return reply.code(500).send({ success: false, error: (error as Error).message });
    }
  });

  fastify.get('/api/github/auth/status', async (_request, reply) => {
    return reply.send(await getGithubAuthStatus());
  });

  fastify.get('/api/system/status', async (_request, reply) => {
    const status = await getSystemStatus(docker);
    return reply.send(status);
  });

  fastify.get('/api/system/orphans', async (_request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const result = await listOrphans(docker);
    return reply.send(result);
  });

  fastify.post('/api/system/cleanup-orphans', async (_request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const result = await cleanupOrphans(docker);
    return reply.send({ success: Object.keys(result.errors).length === 0, ...result });
  });

  fastify.post('/api/system/recover-registry', async (_request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const result = await recoverRegistry(docker);
    return reply.send(result);
  });

  fastify.get('/api/environments/:envId/logs', async (request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const { envId } = request.params as { envId: string };
    const containerName = `devfarm-${envId}`;
    try {
      const logs = await getContainerLogs(docker, containerName, 200);
      return reply.send({ logs });
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  fastify.get('/api/images', async (_request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const images = await listImages(docker);
    return reply.send({ images });
  });

  fastify.post('/api/images/build', async (request, reply) => {
    if (!docker) {
      return reply.code(500).send({ error: 'Docker not available' });
    }
    const { image_type } = (request.body as { image_type?: string }) ?? {};
    const validTypes = ['code-server', 'terminal', 'dashboard'];
    if (!image_type || !validTypes.includes(image_type)) {
      return reply
        .code(400)
        .send({ error: `Invalid image type. Must be one of: ${validTypes.join(', ')}` });
    }

    const result = await buildImage(docker, image_type as 'code-server' | 'terminal' | 'dashboard');
    return reply.send({ success: result.success, output: result.output, exit_code: result.exitCode });
  });

  fastify.post('/api/system/upgrade', async (_request, reply) => {
    const result = await upgradeSystem();
    const status = result.success ? 200 : 500;
    return reply.code(status).send(result);
  });

  fastify.post('/api/system/update/start', async (_request, reply) => {
    if (!docker) {
      return reply.code(500).send({ started: false, message: 'Docker not available' });
    }
    const result = await startSystemUpdate(docker);
    const status = result.started ? 200 : 409;
    return reply.code(status).send(result);
  });

  fastify.get('/api/system/update/status', async (_request, reply) => {
    return reply.send(getUpdateStatus());
  });

  fastify.get('/api/environments/hierarchy', async (_request, reply) => {
    const trees = await getEnvironmentHierarchy(docker);
    return reply.send(trees);
  });

  fastify.get('/health', async (_request, reply) => {
    const status = await getSystemStatus(docker);
    return reply.send({ status: 'healthy', ...status });
  });

  fastify.post('/create', async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (!body) {
      return reply.code(400).send({ error: 'Missing body' });
    }

    const displayName = (typeof body.name === 'string' && body.name.trim()) || `env-${Date.now()}`;
    const envId = kebabify(displayName);
    const mode = (typeof body.mode === 'string' && body.mode) || 'workspace';
    const connectionMode = (typeof body.connection_mode === 'string' && body.connection_mode) || 'web';

    const registry = await loadRegistry();
    if (registry[envId]) {
      return reply.code(400).send({ error: `Environment "${displayName}" already exists` });
    }

    const port = await getNextPort();
    const workspacePath = getWorkspacePath(mode);

    const sshHost = typeof body.ssh_host === 'string' ? body.ssh_host : '';
    const sshUser = typeof body.ssh_user === 'string' ? body.ssh_user : 'root';
    const sshPath = typeof body.ssh_path === 'string' ? body.ssh_path : '/home';
    const sshPassword = typeof body.ssh_password === 'string' ? body.ssh_password : '';
    const gitUrl = typeof body.git_url === 'string' ? body.git_url : '';

    const parentEnvId = typeof body.parent_env_id === 'string' ? body.parent_env_id : undefined;
    const creatorType = (typeof body.creator_type === 'string' ? body.creator_type : 'user') as 'user' | 'ai';
    const creatorName = typeof body.creator_name === 'string' ? body.creator_name : 'Unknown';
    const creatorEnvId = typeof body.creator_env_id === 'string' ? body.creator_env_id : undefined;
    const creationSource = typeof body.creation_source === 'string' ? body.creation_source : 'dashboard';

    const farmConfig = await loadFarmConfig();
    const githubUsername = farmConfig.github?.username || 'developer';
    const githubEmail = farmConfig.github?.email || 'developer@localhost';

    const envVars: Record<string, string> = {
      DEV_MODE: mode,
      CONNECTION_MODE: connectionMode,
      WORKSPACE_NAME: displayName,
      DEVFARM_ENV_ID: envId,
      ENV_NAME: envId,
      GITHUB_USERNAME: githubUsername,
      GITHUB_EMAIL: githubEmail,
    };

    const githubToken = await loadGitHubToken();
    if (githubToken) {
      envVars.GITHUB_TOKEN = githubToken;
    } else {
      fastify.log.warn('GITHUB_TOKEN not configured; environment will be unauthenticated');
    }

    if (mode === 'ssh') {
      envVars.SSH_HOST = sshHost;
      envVars.SSH_USER = sshUser;
      envVars.SSH_PATH = sshPath;
      if (sshPassword) {
        envVars.SSH_PASSWORD = sshPassword;
      }
    }

    if (mode === 'git' && gitUrl) {
      envVars.GIT_URL = gitUrl.startsWith('git@github.com:')
        ? gitUrl.replace('git@github.com:', 'https://github.com/')
        : gitUrl;
    }

    const imageName = mode === 'terminal' ? 'dev-farm/terminal:latest' : 'dev-farm/code-server:latest';

    try {
      await docker.getImage(imageName).inspect();
    } catch (error) {
      return reply.code(500).send({ error: `Image ${imageName} not found. Please rebuild images.` });
    }

    const containerName = `devfarm-${envId}`;

    try {
      const existing = docker.getContainer(containerName);
      await existing.remove({ force: true });
    } catch (error) {
      /* ignore */
    }

    const mounts: Docker.MountSettings[] = [];
    if (mode === 'workspace' || mode === 'git' || mode === 'terminal') {
      mounts.push(
        { Target: '/home/coder/workspace', Source: `devfarm-${envId}`, Type: 'volume', ReadOnly: false },
        { Target: '/home/coder/.vscode-server-insiders', Source: `devfarm-${envId}-vscode`, Type: 'volume', ReadOnly: false }
      );
    } else if (mode === 'ssh') {
      mounts.push({ Target: '/home/coder/.vscode-server-insiders', Source: `devfarm-${envId}-vscode`, Type: 'volume', ReadOnly: false });
    }

    const container = await docker.createContainer({
      Image: imageName,
      name: containerName,
      Env: Object.entries(envVars).map(([key, value]) => `${key}=${value}`),
      Labels: {
        'dev-farm': 'true',
        'dev-farm.id': envId,
        'dev-farm.name': displayName,
        'dev-farm.mode': mode,
      },
      HostConfig: {
        NetworkMode: 'devfarm',
        RestartPolicy: { Name: 'unless-stopped' },
        Mounts: mounts,
        Dns: ['8.8.8.8', '8.8.4.4'],
      },
    });

    await container.start();

    const record: EnvironmentRecord = {
      name: displayName,
      displayName,
      envId,
      containerId: container.id,
      port,
      created: new Date().toISOString(),
      mode: mode as EnvironmentRecord['mode'],
      sshHost: mode === 'ssh' ? sshHost : null,
      sshUser: mode === 'ssh' ? sshUser : null,
      sshPath: mode === 'ssh' ? sshPath : null,
      sshPassword: mode === 'ssh' ? sshPassword || null : null,
      sshAlias: mode === 'ssh' ? containerName : null,
      gitUrl: mode === 'git' ? envVars.GIT_URL ?? null : null,
      parentEnvId: parentEnvId ?? null,
      creatorType,
      creatorName,
      creatorEnvId: creatorEnvId ?? null,
      creationSource,
      children: [],
    };

    await upsertEnvironment(record);

    if (parentEnvId) {
      const parent = await readEnvironment(parentEnvId);
      if (parent && !parent.children.includes(envId)) {
        parent.children.push(envId);
        await upsertEnvironment(parent);
      }
    }

    sseChannel.broadcast('registry-update', { timestamp: Date.now() });

    return {
      success: true,
      env_id: envId,
      display_name: displayName,
      port,
      url: buildTunnelUrl(envId, workspacePath),
      tunnel_name: envId,
      mode,
      workspacePath,
    };
  });

  fastify.post('/delete/:envId', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    try {
      const container = docker.getContainer(record.containerId);
      await container.remove({ force: true });
    } catch (error) {
      fastify.log.warn({ envId, err: error }, 'Failed to remove container');
    }

    try {
      await docker.getVolume(`devfarm-${envId}`).remove({ force: true });
    } catch (error) {
      /* ignore */
    }

    try {
      await docker.getVolume(`devfarm-${envId}-vscode`).remove({ force: true });
    } catch (error) {
      /* ignore */
    }

    await removeEnvironment(envId);
    sseChannel.broadcast('registry-update', { timestamp: Date.now() });
    return { success: true };
  });

  fastify.post('/start/:envId', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }
    try {
      const container = docker.getContainer(record.containerId);
      await container.start();
      const workspacePath = getWorkspacePath(record.mode);
      const desktopCommand = buildDesktopCommand(envId, workspacePath);
      sseChannel.broadcast('env-status', {
        env_id: envId,
        status: 'starting',
        url: buildTunnelUrl(envId, workspacePath),
        workspacePath,
        mode: record.mode,
        desktopCommand,
      });
      return { success: true };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  fastify.post('/stop/:envId', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }
    try {
      const container = docker.getContainer(record.containerId);
      await container.stop();
      const workspacePath = getWorkspacePath(record.mode);
      const desktopCommand = buildDesktopCommand(envId, workspacePath);
      sseChannel.broadcast('env-status', {
        env_id: envId,
        status: 'exited',
        url: buildTunnelUrl(envId, workspacePath),
        workspacePath,
        mode: record.mode,
        desktopCommand,
      });
      return { success: true };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  fastify.post('/api/environments/:envId/restart', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }
    try {
      const container = docker.getContainer(record.containerId);
      await container.restart();
      const workspacePath = getWorkspacePath(record.mode);
      const desktopCommand = buildDesktopCommand(envId, workspacePath);
      sseChannel.broadcast('env-status', {
        env_id: envId,
        status: 'restarting',
        url: buildTunnelUrl(envId, workspacePath),
        workspacePath,
        mode: record.mode,
        desktopCommand,
      });
      return { success: true, message: `Environment ${envId} restarted` };
    } catch (error) {
      return reply.code(500).send({ success: false, error: (error as Error).message });
    }
  });

  fastify.get('/api/environments/:envId/status', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    try {
      const container = docker.getContainer(record.containerId);
      const inspect = await container.inspect();
      const status = inspect.State?.Status ?? 'unknown';
      const ready = await isContainerHealthy(container);
      const stats = status === 'running' ? await getContainerStats(container) : undefined;
      return {
        status: ready ? 'running' : status === 'running' ? 'starting' : status,
        ready,
        stats: stats ?? {},
        env_data: record,
      };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  async function ensureTmuxServer(container: Docker.Container): Promise<void> {
    await execToString(container, 'tmux start-server');
  }

  fastify.post('/api/environments/:envId/ai/chat', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    const { message, tool } = request.body as { message?: string; tool?: 'aider' | 'copilot' };
    if (!message) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    const selectedTool = tool ?? 'copilot';
    const container = docker.getContainer(record.containerId);

    await ensureTmuxServer(container);

    const sessionId = aiSessions.get(envId)?.sessionId ?? randomUUID();
    aiSessions.set(envId, { active: true, tool: selectedTool, sessionId });

    try {
      if (selectedTool === 'aider') {
        const checkOutput = await execToString(container, 'tmux has-session -t devfarm-ai 2>/dev/null || echo "__MISSING__"');
        if (checkOutput.includes('__MISSING__')) {
          await execToString(
            container,
            'tmux new-session -d -s devfarm-ai "cd /workspace && aider --yes-always --message-file /tmp/aider-input.txt"'
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        await execToString(container, `printf %s ${JSON.stringify(message)} > /tmp/aider-input.txt`);
        await execToString(container, `tmux send-keys -t devfarm-ai ${JSON.stringify(message)} Enter`);
      } else {
        const output = await execToString(container, `gh copilot suggest ${JSON.stringify(message)}`, {
          workdir: '/workspace',
        });
        const existing = aiOutputCache.get(envId) ?? '';
        const combined = `${existing}\n\n> ${message}\n${output}`.trim();
        aiOutputCache.set(envId, combined);
        sseChannel.broadcast('ai-response', {
          env_id: envId,
          tool: selectedTool,
          response: output,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        success: true,
        session_id: sessionId,
        message: `Message sent to ${selectedTool}`,
      };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  fastify.get('/api/environments/:envId/ai/output', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    const container = docker.getContainer(record.containerId);
    await ensureTmuxServer(container);

    try {
      const output = await execToString(container, 'tmux capture-pane -t devfarm-ai -p -S -50');
      const copilotOutput = aiOutputCache.get(envId) ?? '';
      return {
        output: output || copilotOutput,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.code(200).send({ output: aiOutputCache.get(envId) ?? '', error: (error as Error).message });
    }
  });

  fastify.post('/api/environments/:envId/ai/stop', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const record = await readEnvironment(envId);
    if (!record) {
      return reply.code(404).send({ error: 'Environment not found' });
    }
    const container = docker.getContainer(record.containerId);
    await ensureTmuxServer(container);

    try {
      await execToString(container, 'tmux kill-session -t devfarm-ai 2>/dev/null');
      aiSessions.set(envId, { active: false, tool: 'copilot', sessionId: randomUUID() });
      return { success: true };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  async function containerFromEnv(envId: string): Promise<{ record: EnvironmentRecord; container: Docker.Container } | null> {
    const record = await readEnvironment(envId);
    if (!record) {
      return null;
    }
    return { record, container: docker.getContainer(record.containerId) };
  }

  fastify.get('/api/environments/:envId/terminal-preview', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const context = await containerFromEnv(envId);
    if (!context) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    try {
      await ensureTmuxServer(context.container);
      const output = await execToString(
        context.container,
        'tmux capture-pane -t devfarm -p -S -50 2>/dev/null || echo "No active session"'
      );
      return { output, timestamp: new Date().toISOString() };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message });
    }
  });

  fastify.get('/api/environments/:envId/git-activity', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const context = await containerFromEnv(envId);
    if (!context) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    try {
      const output = await execToString(
        context.container,
        'git log --oneline -10 --format="%H|%an|%ar|%s" 2>/dev/null || echo ""',
        { workdir: '/workspace' }
      );
      const commits = output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, author, timeAgo, ...messageParts] = line.split('|');
          return { sha: sha?.slice(0, 7) ?? '', author, time: timeAgo, message: messageParts.join('|') };
        });
      return { commits };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message, commits: [] });
    }
  });

  fastify.get('/api/environments/:envId/processes', async (request, reply) => {
    const { envId } = request.params as { envId: string };
    const context = await containerFromEnv(envId);
    if (!context) {
      return reply.code(404).send({ error: 'Environment not found' });
    }

    try {
      const output = await execToString(
        context.container,
        "ps aux | grep -E 'aider|code-insiders|node|python|npm|gh' | grep -v grep"
      );
      const processes = output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parts[1],
            cpu: parts[2],
            mem: parts[3],
            time: parts[9],
            command: parts.slice(10).join(' ').slice(0, 100),
          };
        });
      return { processes };
    } catch (error) {
      return reply.code(500).send({ error: (error as Error).message, processes: [] });
    }
  });

  async function broadcastStatusChanges(): Promise<void> {
    const registry = await loadRegistry();
    for (const [envId, record] of Object.entries(registry)) {
      try {
        const container = docker.getContainer(record.containerId);
        const ready = await isContainerHealthy(container);
        const inspect = await container.inspect();
        const status = inspect.State?.Status ?? 'unknown';
        const displayStatus = ready ? 'running' : status === 'running' ? 'starting' : status;
        const previous = lastKnownStatus.get(envId);
        if (previous !== displayStatus) {
          lastKnownStatus.set(envId, displayStatus);
          const workspacePath = getWorkspacePath(record.mode);
          const desktopCommand = buildDesktopCommand(envId, workspacePath);
          sseChannel.broadcast('env-status', {
            env_id: envId,
            status: displayStatus,
            port: record.port,
            url: buildTunnelUrl(envId, workspacePath),
            workspacePath,
            mode: record.mode,
            desktopCommand,
          });
        }
      } catch (error) {
        fastify.log.debug({ envId, err: error }, 'Failed to monitor container');
      }
    }
  }

  let statusInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  if (enableBackgroundJobs) {
    statusInterval = setInterval(() => {
      broadcastStatusChanges().catch((error) => fastify.log.debug({ error }, 'Status monitor error'));
    }, 2000);
    statusInterval?.unref?.();

    heartbeatInterval = setInterval(() => sseChannel.heartbeat(), 45000);
    heartbeatInterval?.unref?.();

    fastify.addHook('onClose', async () => {
      if (statusInterval) clearInterval(statusInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    });
  }

  await broadcastStatusChanges();

  fastify.setNotFoundHandler((request, reply) => {
    if (clientRoot && request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      return reply.sendFile('index.html');
    }
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      // In dev mode, frontend is served by Vite on port 5173
      return reply.status(200).send({
        message: 'API server is running. Frontend is served by Vite at http://localhost:5173',
        api_server: 'http://localhost:5000',
        frontend_dev_server: 'http://localhost:5173'
      });
    }
    reply.status(404).send({ error: 'Not found' });
  });

  return fastify;
}
