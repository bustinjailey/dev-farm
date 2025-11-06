import type { FastifyInstance } from 'fastify';

import {
  disconnectGithub,
  getGithubAuthStatus,
  getGithubConfig,
  getGithubStatus,
  listGithubRepos,
  logoutGithub,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
  updateGithubConfig,
} from '../../github.js';

export function registerGithubRoutes(fastify: FastifyInstance): void {
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
}
