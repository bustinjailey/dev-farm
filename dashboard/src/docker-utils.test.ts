import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getContainerStats, isContainerHealthy } from './docker-utils.js';
import type Docker from 'dockerode';
import { EventEmitter } from 'events';

class MockReadableStream extends EventEmitter {
  constructor(private data: string) {
    super();
    // Emit data asynchronously
    process.nextTick(() => {
      this.emit('data', Buffer.from(this.data));
      this.emit('end');
    });
  }
}

class MockContainer {
  constructor(
    private statsData: any,
    private inspectData: any,
    private execOutput?: string
  ) { }

  async stats(opts: any) {
    return this.statsData;
  }

  async inspect() {
    return this.inspectData;
  }

  async exec(opts: any) {
    if (this.execOutput === undefined) {
      throw new Error('Exec failed');
    }

    const output = this.execOutput;
    return {
      async start() {
        return new MockReadableStream(output);
      }
    };
  }
}

describe('getContainerStats', () => {
  it('calculates CPU percentage correctly', async () => {
    const container = new MockContainer(
      {
        cpu_stats: {
          cpu_usage: { total_usage: 1000 },
          system_cpu_usage: 10000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 500 },
          system_cpu_usage: 5000,
        },
        memory_stats: {
          usage: 1024 * 1024 * 100, // 100 MB
          limit: 1024 * 1024 * 1000, // 1 GB
        },
      },
      {}
    );

    const stats = await getContainerStats(container as unknown as Docker.Container);

    // (1000 - 500) / (10000 - 5000) * 100 = 10%
    expect(stats.cpu).toBe(10);
  });

  it('calculates memory percentage correctly', async () => {
    const container = new MockContainer(
      {
        cpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 50 },
          system_cpu_usage: 500,
        },
        memory_stats: {
          usage: 1024 * 1024 * 512, // 512 MB
          limit: 1024 * 1024 * 1024, // 1 GB
        },
      },
      {}
    );

    const stats = await getContainerStats(container as unknown as Docker.Container);

    // 512 / 1024 * 100 = 50%
    expect(stats.memory).toBe(50);
  });

  it('calculates memory in MB correctly', async () => {
    const container = new MockContainer(
      {
        cpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 50 },
          system_cpu_usage: 500,
        },
        memory_stats: {
          usage: 1024 * 1024 * 256.7, // ~256.7 MB
          limit: 1024 * 1024 * 1024,
        },
      },
      {}
    );

    const stats = await getContainerStats(container as unknown as Docker.Container);

    expect(stats.memoryMb).toBeCloseTo(256.7, 1);
  });

  it('handles zero system delta gracefully', async () => {
    const container = new MockContainer(
      {
        cpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 100 },
          system_cpu_usage: 1000, // Same as current
        },
        memory_stats: {
          usage: 1024 * 1024 * 100,
          limit: 1024 * 1024 * 1000,
        },
      },
      {}
    );

    const stats = await getContainerStats(container as unknown as Docker.Container);

    expect(stats.cpu).toBe(0);
  });

  it('returns zero stats on error', async () => {
    const container = {
      async stats() {
        throw new Error('Stats failed');
      },
    };

    const stats = await getContainerStats(container as unknown as Docker.Container);

    expect(stats).toEqual({ cpu: 0, memory: 0, memoryMb: 0 });
  });

  it('rounds values to one decimal place', async () => {
    const container = new MockContainer(
      {
        cpu_stats: {
          cpu_usage: { total_usage: 1234 },
          system_cpu_usage: 10000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 789 },
          system_cpu_usage: 5000,
        },
        memory_stats: {
          usage: 1024 * 1024 * 123.456,
          limit: 1024 * 1024 * 1000,
        },
      },
      {}
    );

    const stats = await getContainerStats(container as unknown as Docker.Container);

    // (1234 - 789) / (10000 - 5000) * 100 = 8.9%
    expect(stats.cpu).toBe(8.9);
    // 123.456 / 1000 * 100 = 12.3456% -> 12.3%
    expect(stats.memory).toBe(12.3);
  });
});

describe('isContainerHealthy', () => {
  it('returns true when health check is healthy', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
          Health: { Status: 'healthy' },
        },
      }
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(true);
  });

  it('returns false when health check is unhealthy', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
          Health: { Status: 'unhealthy' },
        },
      }
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('returns false when health check is starting', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
          Health: { Status: 'starting' },
        },
      }
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('checks tunnel process when no health check defined', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
        },
      },
      '12345\n' // PID from pgrep
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(true);
  });

  it('returns false when tunnel process not found', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
        },
      },
      '' // Empty output = process not found
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('returns false when container is not running', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'exited',
        },
      }
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('returns false when exec fails', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
        },
      }
      // No exec output = exec will throw
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('returns false on inspect error', async () => {
    const container = {
      async inspect() {
        throw new Error('Inspect failed');
      },
    };

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(false);
  });

  it('handles whitespace in pgrep output', async () => {
    const container = new MockContainer(
      {},
      {
        State: {
          Status: 'running',
        },
      },
      '  12345  \n  67890  \n' // PIDs with whitespace
    );

    const healthy = await isContainerHealthy(container as unknown as Docker.Container);

    expect(healthy).toBe(true);
  });
});
