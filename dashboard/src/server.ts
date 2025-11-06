import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// IMPORTANT: retain .js extensions for runtime ESM resolution in Node
import { getDocker } from './docker.js';
import { sseChannel, sseHandler } from './sse.js';
import { getSystemStatus } from './system.js';
import { registerTerminalProxy } from './server/terminalProxy.js';
import { createEnvironmentFeature } from './server/routes/environments.js';
import { registerGithubRoutes } from './server/routes/github.js';
import { registerSystemRoutes } from './server/routes/system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distClientRoot = path.join(__dirname, '..', 'client');
const builtClientRoot = path.join(__dirname, '..', 'dist', 'client');
const devFallbackRoot = path.resolve(process.cwd(), 'frontend', 'public');

let clientRoot: string | null = null;
if (fs.existsSync(distClientRoot)) {
  clientRoot = distClientRoot;
} else if (fs.existsSync(builtClientRoot)) {
  clientRoot = builtClientRoot;
} else if (fs.existsSync(devFallbackRoot)) {
  clientRoot = devFallbackRoot;
}

interface ServerOptions {
  enableBackgroundJobs?: boolean;
  logger?: FastifyServerOptions['logger'];
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const { enableBackgroundJobs = true, logger = true } = options;
  const fastify = Fastify({ logger });

  registerTerminalProxy(fastify);

  await fastify.register(cors, { origin: true });

  if (clientRoot) {
    await fastify.register(fastifyStatic, {
      root: clientRoot,
      prefix: '/',
    });
  }

  fastify.get('/api/stream', sseHandler);

  const docker = getDocker();
  const environmentFeature = createEnvironmentFeature(fastify, docker);

  environmentFeature.registerRoutes();
  registerGithubRoutes(fastify);
  registerSystemRoutes(fastify, docker);

  async function broadcastEnvironmentStatus(): Promise<void> {
    await environmentFeature.broadcastStatusChanges();
  }

  let lastSystemStatus: {
    commits_behind?: number;
    current_sha?: string;
    latest_sha?: string;
  } = {};

  async function broadcastSystemStatus(): Promise<void> {
    try {
      const status = await getSystemStatus(docker);
      const hasChanges =
        lastSystemStatus.commits_behind !== status.commits_behind ||
        lastSystemStatus.current_sha !== status.current_sha ||
        lastSystemStatus.latest_sha !== status.latest_sha;

      if (hasChanges) {
        lastSystemStatus = {
          commits_behind: status.commits_behind,
          current_sha: status.current_sha,
          latest_sha: status.latest_sha,
        };

        sseChannel.broadcast('system-status', {
          updates_available: status.updates_available,
          commits_behind: status.commits_behind,
          current_sha: status.current_sha,
          latest_sha: status.latest_sha,
        });

        fastify.log.info(
          {
            commits_behind: status.commits_behind,
            current_sha: status.current_sha,
            latest_sha: status.latest_sha,
          },
          'System status changed - new commits detected'
        );
      }
    } catch (error) {
      fastify.log.debug({ error }, 'Failed to check system status');
    }
  }

  let statusInterval: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let systemStatusInterval: NodeJS.Timeout | null = null;

  if (enableBackgroundJobs) {
    statusInterval = setInterval(() => {
      broadcastEnvironmentStatus().catch((error) => fastify.log.debug({ error }, 'Status monitor error'));
    }, 2000);
    statusInterval?.unref?.();

    systemStatusInterval = setInterval(() => {
      broadcastSystemStatus().catch((error) => fastify.log.debug({ error }, 'System status check error'));
    }, 60000);
    systemStatusInterval?.unref?.();

    heartbeatInterval = setInterval(() => sseChannel.heartbeat(), 45000);
    heartbeatInterval?.unref?.();

    fastify.addHook('onClose', async () => {
      if (statusInterval) clearInterval(statusInterval);
      if (systemStatusInterval) clearInterval(systemStatusInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    });
  }

  await broadcastSystemStatus();
  await broadcastEnvironmentStatus();

  fastify.setNotFoundHandler((request, reply) => {
    if (clientRoot && request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      return reply.sendFile('index.html');
    }
    if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
      return reply.status(200).send({
        message: 'API server is running. Frontend is served by Vite at http://localhost:5173',
        api_server: 'http://localhost:5000',
        frontend_dev_server: 'http://localhost:5173',
      });
    }
    reply.status(404).send({ error: 'Not found' });
  });

  return fastify;
}
