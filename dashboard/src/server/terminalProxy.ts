import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import httpProxy from 'http-proxy';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';

import { readEnvironment } from '../registry.js';

function buildTerminalForwardUrl(envId: string, requestUrl?: string): string {
  if (!requestUrl) {
    return '/';
  }

  try {
    const parsed = new URL(requestUrl, 'http://localhost');
    const prefix = `/terminal/${envId}`;
    if (!parsed.pathname.startsWith(prefix)) {
      return '/';
    }

    const remainder = parsed.pathname.slice(prefix.length) || '/';
    const normalizedPath = remainder.startsWith('/') ? remainder : `/${remainder}`;
    return `${normalizedPath}${parsed.search}`;
  } catch {
    return '/';
  }
}

function extractTerminalInfo(requestUrl?: string): { envId: string; forwardUrl: string } | null {
  if (!requestUrl) {
    return null;
  }

  try {
    const parsed = new URL(requestUrl, 'http://localhost');
    const match = parsed.pathname.match(/^\/terminal\/([^/]+)(.*)$/);
    if (!match) {
      return null;
    }

    const envId = match[1];
    const rest = match[2] ?? '';
    const normalized = rest ? (rest.startsWith('/') ? rest : `/${rest}`) : '/';
    return {
      envId,
      forwardUrl: `${normalized}${parsed.search}`,
    };
  } catch {
    return null;
  }
}

async function resolveTerminalProxyTarget(envId: string): Promise<string | null> {
  const record = await readEnvironment(envId);
  if (!record || record.mode !== 'terminal') {
    return null;
  }

  // With host networking, all containers share the host's network namespace
  // Each terminal container uses a unique port (from registry) instead of 8080
  // The PORT environment variable is passed to the container at creation
  return `http://localhost:${record.port}`;
}

export function registerTerminalProxy(fastify: FastifyInstance): void {
  const terminalProxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });

  terminalProxy.on('error', (error: Error, _req: IncomingMessage, res: ServerResponse | Socket | undefined) => {
    fastify.log.error({ err: error }, 'Terminal proxy error');

    if (!res) {
      return;
    }

    if ('writeHead' in res && typeof res.writeHead === 'function') {
      try {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' });
        }
        res.end('Unable to reach terminal environment');
      } catch (proxyErr) {
        fastify.log.error({ err: proxyErr }, 'Failed to finalize proxy error response');
      }
      return;
    }

    if ('destroy' in res && typeof res.destroy === 'function') {
      try {
        res.destroy();
      } catch (proxyErr) {
        fastify.log.error({ err: proxyErr }, 'Failed to destroy proxy socket');
      }
    }
  });

  async function proxyTerminalHttp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { envId } = request.params as { envId: string };
    const target = await resolveTerminalProxyTarget(envId);

    if (!target) {
      await reply.code(404).send({ error: 'Terminal environment is unavailable' });
      return;
    }

    const forwardUrl = buildTerminalForwardUrl(envId, request.raw.url ?? '/');

    reply.hijack();
    request.raw.url = forwardUrl;

    terminalProxy.web(request.raw, reply.raw, { target }, (err: Error) => {
      if (err) {
        fastify.log.error({ envId, err }, 'Terminal HTTP proxy failed');
        try {
          if (!reply.raw.headersSent) {
            reply.raw.writeHead(502, { 'content-type': 'text/plain' });
          }
          reply.raw.end('Terminal proxy error');
        } catch (proxyErr) {
          fastify.log.error({ envId, err: proxyErr }, 'Failed to send terminal proxy error response');
        }
      }
    });
  }

  fastify.all('/terminal/:envId', proxyTerminalHttp);
  fastify.all('/terminal/:envId/*', proxyTerminalHttp);

  const handleTerminalUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    fastify.log.info({ url: req.url, headers: req.headers }, 'WebSocket upgrade request received');
    const info = extractTerminalInfo(req.url);
    if (!info) {
      fastify.log.warn({ url: req.url }, 'WebSocket upgrade - failed to extract terminal info');
      return;
    }

    fastify.log.info({ envId: info.envId, forwardUrl: info.forwardUrl }, 'WebSocket upgrade - extracted terminal info');
    resolveTerminalProxyTarget(info.envId)
      .then((target) => {
        if (!target) {
          fastify.log.warn({ envId: info.envId }, 'WebSocket upgrade - target not found');
          try {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          } catch {
            /* ignore */
          }
          socket.destroy();
          return;
        }

        fastify.log.info({ envId: info.envId, target, forwardUrl: info.forwardUrl }, 'WebSocket upgrade - proxying to target');
        req.url = info.forwardUrl;
        terminalProxy.ws(req, socket, head, { target });
      })
      .catch((err) => {
        fastify.log.error({ envId: info.envId, err }, 'Terminal WS proxy failed');
        if (!socket.destroyed) {
          try {
            socket.destroy();
          } catch (destroyErr) {
            fastify.log.error({ envId: info.envId, err: destroyErr }, 'Failed to destroy socket after proxy failure');
          }
        }
      });
  };

  fastify.server.on('upgrade', handleTerminalUpgrade);

  fastify.addHook('onClose', async () => {
    fastify.server.off('upgrade', handleTerminalUpgrade);
    terminalProxy.close();
  });
}
