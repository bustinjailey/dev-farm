import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

interface SSEClient {
  id: string;
  reply: FastifyReply;
}

export class SSEChannel {
  private clients = new Map<string, SSEClient>();

  register(reply: FastifyReply): () => void {
    reply.type('text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('X-Accel-Buffering', 'no');

    const id = randomUUID();
    const client: SSEClient = { id, reply };
    this.clients.set(id, client);

    reply.raw.on('close', () => {
      this.clients.delete(id);
    });

    this.send(reply, 'connected', { type: 'connected' });

    return () => {
      this.clients.delete(id);
    };
  }

  broadcast(event: string, data: unknown): void {
    for (const client of this.clients.values()) {
      this.send(client.reply, event, data);
    }
  }

  private send(reply: FastifyReply, event: string, data: unknown): void {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  heartbeat(): void {
    for (const client of this.clients.values()) {
      client.reply.raw.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }
  }
}

export const sseChannel = new SSEChannel();

export const sseHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const unregister = sseChannel.register(reply);
  request.raw.on('close', unregister);
  request.raw.on('error', unregister);
  // keep connection open
};

