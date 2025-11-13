import type { FastifyInstance } from 'fastify';
import type Docker from 'dockerode';
import { randomUUID } from 'crypto';

import { execToString } from '../../container-exec.js';
import { getContainerStats, isContainerHealthy } from '../../docker-utils.js';
import {
  buildDesktopCommand,
  buildTerminalUrl,
  buildTunnelUrl,
  getWorkspacePath,
  loadFarmConfig,
  loadGitHubToken,
  kebabify,
} from '../../env-utils.js';
import { getContainerLogs, getEnvironmentHierarchy } from '../../system.js';
import {
  getNextPort,
  loadRegistry,
  readEnvironment,
  removeEnvironment,
  upsertEnvironment,
} from '../../registry.js';
import { sseChannel } from '../../sse.js';
import type { EnvironmentRecord, EnvironmentSummary } from '../../types.js';

const adjectives = [
  'happy', 'sleepy', 'bouncy', 'clever', 'quirky', 'zesty', 'mighty', 'gentle',
  'swift', 'brave', 'calm', 'wise', 'eager', 'jolly', 'proud', 'noble',
  'bright', 'silent', 'cosmic', 'golden', 'silver', 'crystal', 'electric', 'turbo'
];

const nouns = [
  'panda', 'falcon', 'dragon', 'phoenix', 'tiger', 'wolf', 'eagle', 'bear',
  'lion', 'hawk', 'fox', 'otter', 'raven', 'owl', 'lynx', 'cobra',
  'shark', 'whale', 'dolphin', 'penguin', 'octopus', 'squid', 'mantis', 'spider'
];

const verbs = [
  'coding', 'building', 'testing', 'deploying', 'debugging', 'shipping', 'hacking', 'crafting',
  'forging', 'brewing', 'weaving', 'sculpting', 'painting', 'dancing', 'flying', 'racing'
];

function generateFunName(): string {
  const MAX_NAME_LENGTH = 20;
  let attempts = 0;
  const MAX_ATTEMPTS = 100;

  while (attempts < MAX_ATTEMPTS) {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    const name = `${adj}-${noun}-${verb}`;

    if (name.length <= MAX_NAME_LENGTH) {
      return name;
    }
    attempts++;
  }

  return `env-${randomUUID().slice(0, 15)}`;
}

export interface EnvironmentFeature {
  registerRoutes(): void;
  getEnvironmentSummaries(): Promise<EnvironmentSummary[]>;
  broadcastStatusChanges(): Promise<void>;
}

export function createEnvironmentFeature(fastify: FastifyInstance, docker: Docker): EnvironmentFeature {
  const lastKnownStatus = new Map<string, string>();
  const lastKnownDeviceAuth = new Map<string, { code: string; url: string }>();
  const aiSessions = new Map<string, { active: boolean; sessionId: string }>();
  const aiOutputCache = new Map<string, string>();

  async function ensureTmuxServer(container: Docker.Container): Promise<void> {
    await execToString(container, 'tmux start-server');
  }

  async function containerFromEnv(envId: string): Promise<{ record: EnvironmentRecord; container: Docker.Container } | null> {
    const record = await readEnvironment(envId);
    if (!record) {
      return null;
    }
    return { record, container: docker.getContainer(record.containerId) };
  }

  async function readCopilotDeviceAuth(container: Docker.Container): Promise<{ code: string; url: string } | null> {
    try {
      const output = await execToString(container, 'cat /root/workspace/.copilot-device-auth.json 2>/dev/null || echo ""');
      if (!output || output.trim() === '') {
        return null;
      }
      const parsed = JSON.parse(output.trim());
      if (parsed.code && parsed.url) {
        return { code: parsed.code, url: parsed.url };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  async function getEnvironmentSummaries(): Promise<EnvironmentSummary[]> {
    const registry = await loadRegistry();
    const summaries: EnvironmentSummary[] = [];

    for (const [envId, env] of Object.entries(registry)) {
      try {
        const container = docker.getContainer(env.containerId);
        const inspect = await container.inspect();
        const status = inspect.State?.Status ?? 'unknown';
        const ready = await isContainerHealthy(container, docker);
        let displayStatus = ready ? 'running' : status === 'running' ? 'starting' : status;
        const workspacePath = getWorkspacePath(env.mode);
        const summaryUrl = env.mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);

        let requiresAuth = lastKnownDeviceAuth.has(envId);
        let deviceAuth = requiresAuth ? lastKnownDeviceAuth.get(envId) ?? null : null;

        // For terminal mode: check if auth is still required and override status
        if (env.mode === 'terminal' && (displayStatus === 'starting' || displayStatus === 'running')) {
          try {
            const authStatus = await execToString(
              container,
              'cat /root/workspace/.copilot-auth-status 2>/dev/null || echo "unknown"'
            ).catch(() => 'unknown');

            const copilotStatus = authStatus.trim();
            if (copilotStatus !== 'authenticated' && copilotStatus !== 'unknown') {
              requiresAuth = true;
              // Override status to "starting" if auth required but container shows running
              if (displayStatus === 'running') {
                displayStatus = 'starting';
              }
            }
          } catch (error) {
            // If we can't check auth status, assume it's required if container is starting
            if (displayStatus === 'starting') {
              requiresAuth = true;
            }
          }
        }

        summaries.push({
          name: env.displayName ?? env.name,
          id: envId,
          port: env.port,
          status: displayStatus,
          ready,
          url: summaryUrl,
          desktopCommand: buildDesktopCommand(envId, workspacePath),
          workspacePath,
          mode: env.mode,
          requiresAuth,
          deviceAuth,
          created: env.created,
          lastStarted: env.lastStarted,
        });
      } catch (error) {
        fastify.log.warn({ envId, err: error }, 'Failed to inspect container');
      }
    }

    return summaries;
  }

  async function broadcastStatusChanges(): Promise<void> {
    const registry = await loadRegistry();
    for (const [envId, record] of Object.entries(registry)) {
      try {
        const container = docker.getContainer(record.containerId);
        const ready = await isContainerHealthy(container, docker);
        const inspect = await container.inspect();
        const status = inspect.State?.Status ?? 'unknown';
        let displayStatus = ready ? 'running' : status === 'running' ? 'starting' : status;

        let requiresAuth = false;
        let deviceAuthInfo: { code: string; url: string } | null = null;

        fastify.log.info({ envId, displayStatus, mode: record.mode }, 'Monitoring environment');

        if (displayStatus === 'starting' || displayStatus === 'running') {
          try {
            // Check for terminal mode Copilot device auth first
            if (record.mode === 'terminal') {
              // Check auth status file first
              const authStatus = await execToString(
                container,
                'cat /root/workspace/.copilot-auth-status 2>/dev/null || echo "unknown"'
              ).catch((err) => {
                fastify.log.warn({ envId, err }, 'Failed to read auth status');
                return 'unknown';
              });

              const status = (authStatus || 'unknown').trim();
              fastify.log.info({ envId, status, mode: record.mode }, 'Terminal mode: Copilot auth status check');

              if (status === 'authenticated') {
                // Authentication completed - clear device auth state
                if (lastKnownDeviceAuth.has(envId)) {
                  lastKnownDeviceAuth.delete(envId);
                  fastify.log.info({ envId }, 'Copilot authenticated successfully');
                  sseChannel.broadcast('copilot-ready', {
                    env_id: envId,
                    status: 'ready',
                  });
                }
                requiresAuth = false;
                deviceAuthInfo = null;
              } else if (status === 'timeout') {
                // Authentication timed out
                requiresAuth = true;
                deviceAuthInfo = { code: 'TIMEOUT', url: '' };
              } else {
                // Broadcast granular status for setup progress
                const lastStatus = lastKnownStatus.get(`${envId}:copilot-status`);
                if (lastStatus !== status && ['configuring', 'workspace-trust', 'login', 'account-selection', 'awaiting-auth', 'pending'].includes(status)) {
                  lastKnownStatus.set(`${envId}:copilot-status`, status);
                  sseChannel.broadcast('copilot-status', {
                    env_id: envId,
                    status: status,
                  });
                  fastify.log.info({ envId, status }, 'Copilot setup progress');
                }

                // Check for device auth file when awaiting/pending auth
                const copilotAuth = ['awaiting-auth', 'pending'].includes(status) ? await readCopilotDeviceAuth(container) : null;
                if (copilotAuth) {
                  const cached = lastKnownDeviceAuth.get(envId);
                  if (!cached || cached.code !== copilotAuth.code) {
                    lastKnownDeviceAuth.set(envId, copilotAuth);
                    fastify.log.info({ envId, code: copilotAuth.code }, 'Device auth code available');
                    sseChannel.broadcast('device-auth', {
                      env_id: envId,
                      url: copilotAuth.url,
                      code: copilotAuth.code,
                    });
                  }
                  requiresAuth = true;
                  deviceAuthInfo = copilotAuth;
                } else if (!copilotAuth && lastKnownDeviceAuth.has(envId)) {
                  // Auth file removed but status not yet authenticated
                  requiresAuth = true;
                  deviceAuthInfo = lastKnownDeviceAuth.get(envId) ?? null;
                }
              }

              // For terminal mode: override status to "starting" if auth is required
              // This prevents the environment from appearing "running" until auth completes
              if (requiresAuth && displayStatus === 'running') {
                displayStatus = 'starting';
              }
            } else {
              // Tunnel mode: check logs for device auth
              const logs = await getContainerLogs(docker, record.containerId, 100);
              const authMatch = logs.match(/log into (https:\/\/[^\s]+) and use code ([A-Z0-9-]+)/);

              if (authMatch) {
                const deviceAuth = { url: authMatch[1], code: authMatch[2] };
                const tunnelReady = logs.includes('Open this link in your browser');

                if (tunnelReady) {
                  if (lastKnownDeviceAuth.has(envId)) {
                    lastKnownDeviceAuth.delete(envId);
                    fastify.log.info({ envId }, 'Device auth completed');
                  }
                  requiresAuth = false;
                  deviceAuthInfo = null;
                } else {
                  const cached = lastKnownDeviceAuth.get(envId);
                  if (!cached || cached.code !== deviceAuth.code) {
                    lastKnownDeviceAuth.set(envId, deviceAuth);
                    fastify.log.info({ envId, code: deviceAuth.code }, 'Device auth required (new code)');
                    sseChannel.broadcast('device-auth', {
                      env_id: envId,
                      url: deviceAuth.url,
                      code: deviceAuth.code,
                    });
                  }
                  requiresAuth = true;
                  deviceAuthInfo = deviceAuth;
                }
              } else {
                const tunnelReady = ['Open this link in your browser', 'Visual Studio Code Server'].some((pattern) =>
                  logs.includes(pattern)
                );
                if (tunnelReady && lastKnownDeviceAuth.has(envId)) {
                  lastKnownDeviceAuth.delete(envId);
                  fastify.log.info({ envId }, 'Tunnel ready (no auth required)');
                }
                requiresAuth = false;
                deviceAuthInfo = null;
              }
            }
          } catch (error) {
            fastify.log.warn({ envId, err: error }, 'Failed to fetch device auth info');
          }
        } else if (lastKnownDeviceAuth.has(envId)) {
          lastKnownDeviceAuth.delete(envId);
        }

        const previous = lastKnownStatus.get(envId);
        const previousAuthRequired = lastKnownStatus.get(`${envId}:auth`) === 'true';
        const authStateChanged = previousAuthRequired !== requiresAuth;

        if (previous !== displayStatus || authStateChanged) {
          lastKnownStatus.set(envId, displayStatus);
          lastKnownStatus.set(`${envId}:auth`, requiresAuth ? 'true' : 'false');
          const workspacePath = getWorkspacePath(record.mode);
          const desktopCommand = buildDesktopCommand(envId, workspacePath);
          const statusUrl = record.mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);
          sseChannel.broadcast('env-status', {
            env_id: envId,
            status: displayStatus,
            port: record.port,
            url: statusUrl,
            workspacePath,
            mode: record.mode,
            desktopCommand,
            requiresAuth,
            deviceAuth: deviceAuthInfo,
          });
        }
      } catch (error) {
        fastify.log.debug({ envId, err: error }, 'Failed to monitor container');
      }
    }
  }

  function registerRoutes(): void {
    fastify.get('/api/environments', async () => getEnvironmentSummaries());

    fastify.get('/api/environments/:envId/logs', async (request, reply) => {
      const { envId } = request.params as { envId: string };
      const containerName = `devfarm-${envId}`;
      try {
        const logs = await getContainerLogs(docker, containerName, 200);
        return reply.send({ logs });
      } catch (error) {
        return reply.code(500).send({ error: (error as Error).message });
      }
    });

    fastify.get('/api/environments/hierarchy', async (_request, reply) => {
      const trees = await getEnvironmentHierarchy(docker);
      return reply.send(trees);
    });

    fastify.post('/create', async (request, reply) => {
      const body = request.body as Record<string, unknown> | undefined;
      if (!body) {
        return reply.code(400).send({ error: 'Missing body' });
      }

      const userProvidedName = typeof body.name === 'string' ? body.name.trim() : '';
      const displayName = userProvidedName || generateFunName();
      const envId = userProvidedName ? kebabify(userProvidedName) : kebabify(displayName);
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

      if (farmConfig.mcp?.env) {
        for (const [key, value] of Object.entries(farmConfig.mcp.env)) {
          if (value) {
            envVars[key] = value;
          }
        }
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

      // For terminal mode with host networking, assign unique port
      if (mode === 'terminal') {
        envVars.PORT = String(port);
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
      } catch {
        /* ignore */
      }

      const mounts: Docker.MountSettings[] = [];
      if (mode === 'workspace' || mode === 'git' || mode === 'terminal') {
        mounts.push(
          { Target: '/root/workspace', Source: `devfarm-${envId}`, Type: 'volume', ReadOnly: false }
        );
      } else if (mode === 'ssh') {
        mounts.push({ Target: '/root/.vscode-server-insiders', Source: `devfarm-${envId}-vscode`, Type: 'volume', ReadOnly: false });
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
          NetworkMode: 'host',
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

      const environmentUrl = mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);

      return {
        success: true,
        env_id: envId,
        display_name: displayName,
        port,
        url: environmentUrl,
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
      } catch {
        /* ignore */
      }

      try {
        await docker.getVolume(`devfarm-${envId}-vscode`).remove({ force: true });
      } catch {
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

        // Update lastStarted timestamp
        record.lastStarted = new Date().toISOString();
        await upsertEnvironment(record);

        const workspacePath = getWorkspacePath(record.mode);
        const desktopCommand = buildDesktopCommand(envId, workspacePath);
        const statusUrl = record.mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);
        sseChannel.broadcast('env-status', {
          env_id: envId,
          status: 'starting',
          url: statusUrl,
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
        const statusUrl = record.mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);
        sseChannel.broadcast('env-status', {
          env_id: envId,
          status: 'exited',
          url: statusUrl,
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
        await container.start();

        // Update lastStarted timestamp
        record.lastStarted = new Date().toISOString();
        await upsertEnvironment(record);

        const workspacePath = getWorkspacePath(record.mode);
        const desktopCommand = buildDesktopCommand(envId, workspacePath);
        const statusUrl = record.mode === 'terminal' ? buildTerminalUrl(envId) : buildTunnelUrl(envId, workspacePath);
        sseChannel.broadcast('env-status', {
          env_id: envId,
          status: 'restarting',
          url: statusUrl,
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
        const ready = await isContainerHealthy(container, docker);
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

    fastify.post('/api/environments/:envId/ai/chat', async (request, reply) => {
      const { envId } = request.params as { envId: string };
      const record = await readEnvironment(envId);
      if (!record) {
        return reply.code(404).send({ error: 'Environment not found' });
      }

      const { message } = request.body as { message?: string };
      if (!message) {
        return reply.code(400).send({ error: 'Message is required' });
      }

      const container = docker.getContainer(record.containerId);

      await ensureTmuxServer(container);

      const sessionId = aiSessions.get(envId)?.sessionId ?? randomUUID();
      aiSessions.set(envId, { active: true, sessionId });

      try {
        let output: string;

        // Use different commands based on environment mode
        if (record.mode === 'terminal') {
          // Terminal mode: Use the new copilot CLI via wrapper script
          output = await execToString(container, `/root/copilot-chat.sh ${JSON.stringify(message)}`, {
            workdir: '/root/workspace',
          });
        } else {
          // Other modes: Use gh copilot for now (may need update later)
          try {
            output = await execToString(container, `gh copilot suggest ${JSON.stringify(message)}`, {
              workdir: '/workspace',
            });
          } catch (ghError) {
            // If gh copilot fails (deprecated), provide helpful message
            output = `Note: gh copilot is deprecated. For terminal environments, the new @github/copilot CLI is used.\n\nOriginal error: ${(ghError as Error).message}`;
          }
        }

        const existing = aiOutputCache.get(envId) ?? '';
        const combined = `${existing}\n\n> ${message}\n${output}`.trim();
        aiOutputCache.set(envId, combined);
        sseChannel.broadcast('ai-response', {
          env_id: envId,
          response: output,
        });
        return { success: true, session_id: sessionId };
      } catch (error) {
        fastify.log.error({ envId, err: error }, 'Failed to send AI message');
        return reply.code(500).send({ error: (error as Error).message });
      }
    });

    fastify.post<{ Params: { envId: string } }>('/api/environments/:envId/ai/stop', async (request, reply) => {
      const { envId } = request.params;
      const registry = await loadRegistry();
      const record = registry[envId];
      if (!record) {
        return reply.code(404).send({ error: 'Environment not found' });
      }
      const container = docker.getContainer(record.containerId);
      await ensureTmuxServer(container);

      try {
        await execToString(container, 'tmux kill-session -t dev-farm 2>/dev/null');
        aiSessions.set(envId, { active: false, sessionId: randomUUID() });
        return { success: true };
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
        const output = await execToString(container, 'tmux capture-pane -t dev-farm -p -S -50');
        const copilotOutput = aiOutputCache.get(envId) ?? '';
        return {
          output: output || copilotOutput,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        return reply.code(200).send({ output: aiOutputCache.get(envId) ?? '', error: (error as Error).message });
      }
    });

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
        const workspacePath = getWorkspacePath(context.record.mode);
        const output = await execToString(
          context.container,
          'git log --oneline -10 --format="%H|%an|%ar|%s" 2>/dev/null || echo ""',
          { workdir: workspacePath }
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
          "ps aux | grep -E 'code-insiders|node|python|npm|gh' | grep -v grep"
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
  }

  return {
    registerRoutes,
    getEnvironmentSummaries,
    broadcastStatusChanges,
  };
}
