import { buildServer } from './server.js';

const fastify = await buildServer();

const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port, host });
  fastify.log.info(`Dev Farm dashboard listening on http://${host}:${port}`);
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
