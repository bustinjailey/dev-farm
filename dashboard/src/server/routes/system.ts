import type { FastifyInstance } from 'fastify';
import type Docker from 'dockerode';

import {
  cleanupOrphans,
  getSystemStatus,
  listImages,
  listOrphans,
  recoverRegistry,
  upgradeSystem,
  buildImage,
} from '../../system.js';
import { getUpdateStatus, startSystemUpdate } from '../../system-update.js';
import { sseChannel } from '../../sse.js';

export function registerSystemRoutes(fastify: FastifyInstance, docker: Docker): void {
  fastify.get('/api/system/status', async (_request, reply) => {
    const status = await getSystemStatus(docker);
    return reply.send(status);
  });

  fastify.get('/api/system/orphans', async (_request, reply) => {
    const result = await listOrphans(docker);
    return reply.send(result);
  });

  fastify.post('/api/system/cleanup-orphans', async (_request, reply) => {
    const result = await cleanupOrphans(docker);
    return reply.send({ success: Object.keys(result.errors).length === 0, ...result });
  });

  fastify.post('/api/system/recover-registry', async (_request, reply) => {
    const result = await recoverRegistry(docker);
    sseChannel.broadcast('registry-update', { timestamp: Date.now() });
    return reply.send(result);
  });

  fastify.get('/api/images', async (_request, reply) => {
    const images = await listImages(docker);
    return reply.send({ images });
  });

  fastify.get('/api/images/build-times', async (_request, reply) => {
    try {
      const images = await listImages(docker);
      const buildTimes: Record<string, string> = {};

      // Map image names to their build times using exact matches
      // This prevents old legacy images (dev-farm-terminal) from overwriting new ones (dev-farm/terminal)
      for (const image of images) {
        const name = image.name.toLowerCase();
        if (name === 'dev-farm-dashboard') {
          buildTimes.dashboard = image.created;
        } else if (name === 'dev-farm/terminal') {
          buildTimes.terminal = image.created;
        } else if (name === 'dev-farm/code-server') {
          buildTimes['code-server'] = image.created;
        }
      }

      return reply.send({ buildTimes });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get image last build times');
      return reply.code(500).send({ error: 'Failed to retrieve build times' });
    }
  });

  fastify.post('/api/images/build', async (request, reply) => {
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
    const result = await startSystemUpdate(docker);
    const status = result.started ? 200 : 409;
    return reply.code(status).send(result);
  });

  fastify.get('/api/system/update/status', async (_request, reply) => {
    return reply.send(getUpdateStatus());
  });

  fastify.get('/health', async (_request, reply) => {
    const status = await getSystemStatus(docker);
    return reply.send({ status: 'healthy', ...status });
  });
}
