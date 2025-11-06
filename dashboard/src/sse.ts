import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

interface SSEClient {
  id: string;
  reply: FastifyReply;
}

export class SSEChannel {
  private clients = new Map<string, SSEClient>();
  private replyToId = new WeakMap<FastifyReply, string>();

  register(reply: FastifyReply): string {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const id = randomUUID();
    const client: SSEClient = { id, reply };
    this.clients.set(id, client);
    this.replyToId.set(reply, id);

    this.send(reply, 'connected', { type: 'connected' });

    return id;
  }

  unregister(reply: FastifyReply): void {
    const id = this.replyToId.get(reply);
    if (id) {
      this.clients.delete(id);
      this.replyToId.delete(reply);
    }
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
  // Prevent Fastify from automatically sending the response
  reply.hijack();
  
  return new Promise((resolve) => {
    const unregister = () => {
      sseChannel.unregister(reply);
      reply.raw.end();
      resolve();
    };
    
    sseChannel.register(reply);
    
    request.raw.on('close', unregister);
    request.raw.on('error', unregister);
    reply.raw.on('close', unregister);
  });
};

