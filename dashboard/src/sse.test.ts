import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SSEChannel } from './sse.js';
import type { FastifyReply } from 'fastify';

class MockReply {
  raw = {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  hijack() { }
}

describe('SSEChannel', () => {
  let channel: SSEChannel;
  let mockReply: MockReply;

  beforeEach(() => {
    channel = new SSEChannel();
    mockReply = new MockReply();
  });

  describe('register', () => {
    it('sets correct SSE headers', () => {
      channel.register(mockReply as unknown as FastifyReply);

      expect(mockReply.raw.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('sends connected event immediately', () => {
      channel.register(mockReply as unknown as FastifyReply);

      expect(mockReply.raw.write).toHaveBeenCalledWith('event: connected\n');
      expect(mockReply.raw.write).toHaveBeenCalledWith(
        expect.stringMatching(/^data: \{"type":"connected"\}\n\n$/)
      );
    });

    it('returns unique client ID', () => {
      const id1 = channel.register(mockReply as unknown as FastifyReply);
      const id2 = channel.register(new MockReply() as unknown as FastifyReply);

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('unregister', () => {
    it('removes client from channel', () => {
      channel.register(mockReply as unknown as FastifyReply);
      channel.unregister(mockReply as unknown as FastifyReply);

      // Broadcasting after unregister should not write to this reply
      mockReply.raw.write.mockClear();
      channel.broadcast('test', { data: 'value' });
      expect(mockReply.raw.write).not.toHaveBeenCalled();
    });

    it('handles unregister of non-registered client', () => {
      // Should not throw
      expect(() => channel.unregister(mockReply as unknown as FastifyReply)).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('sends event to all registered clients', () => {
      const reply1 = new MockReply();
      const reply2 = new MockReply();
      const reply3 = new MockReply();

      channel.register(reply1 as unknown as FastifyReply);
      channel.register(reply2 as unknown as FastifyReply);
      channel.register(reply3 as unknown as FastifyReply);

      reply1.raw.write.mockClear();
      reply2.raw.write.mockClear();
      reply3.raw.write.mockClear();

      channel.broadcast('test-event', { key: 'value', number: 42 });

      for (const reply of [reply1, reply2, reply3]) {
        expect(reply.raw.write).toHaveBeenCalledWith('event: test-event\n');
        expect(reply.raw.write).toHaveBeenCalledWith('data: {"key":"value","number":42}\n\n');
      }
    });

    it('does not send to unregistered clients', () => {
      const reply1 = new MockReply();
      const reply2 = new MockReply();

      channel.register(reply1 as unknown as FastifyReply);
      channel.register(reply2 as unknown as FastifyReply);
      channel.unregister(reply1 as unknown as FastifyReply);

      reply1.raw.write.mockClear();
      reply2.raw.write.mockClear();

      channel.broadcast('test', { data: 'value' });

      expect(reply1.raw.write).not.toHaveBeenCalled();
      expect(reply2.raw.write).toHaveBeenCalled();
    });

    it('serializes complex data correctly', () => {
      channel.register(mockReply as unknown as FastifyReply);
      mockReply.raw.write.mockClear();

      const complexData = {
        string: 'text',
        number: 123,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: { a: 1, b: { c: 2 } },
      };

      channel.broadcast('complex', complexData);

      expect(mockReply.raw.write).toHaveBeenCalledWith(
        `data: ${JSON.stringify(complexData)}\n\n`
      );
    });
  });

  describe('heartbeat', () => {
    it('sends heartbeat comment to all clients', () => {
      const reply1 = new MockReply();
      const reply2 = new MockReply();

      channel.register(reply1 as unknown as FastifyReply);
      channel.register(reply2 as unknown as FastifyReply);

      reply1.raw.write.mockClear();
      reply2.raw.write.mockClear();

      channel.heartbeat();

      for (const reply of [reply1, reply2]) {
        expect(reply.raw.write).toHaveBeenCalledWith(
          expect.stringMatching(/^: heartbeat \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n\n$/)
        );
      }
    });

    it('does not throw with no clients', () => {
      expect(() => channel.heartbeat()).not.toThrow();
    });
  });

  describe('event format', () => {
    it('follows SSE protocol format', () => {
      channel.register(mockReply as unknown as FastifyReply);
      mockReply.raw.write.mockClear();

      channel.broadcast('my-event', { test: 'data' });

      const calls = mockReply.raw.write.mock.calls;
      expect(calls[0][0]).toBe('event: my-event\n');
      expect(calls[1][0]).toBe('data: {"test":"data"}\n\n');
    });
  });
});
