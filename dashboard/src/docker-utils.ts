import type Docker from 'dockerode';
import type { ContainerStats } from './types.js';

export async function getContainerStats(container: Docker.Container): Promise<ContainerStats> {
  try {
    const stats = await container.stats({ stream: false });
    const cpuDelta = stats.cpu_stats?.cpu_usage?.total_usage - stats.precpu_stats?.cpu_usage?.total_usage || 0;
    const systemDelta = stats.cpu_stats?.system_cpu_usage - stats.precpu_stats?.system_cpu_usage || 0;
    const cpu = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

    const memoryUsage = stats.memory_stats?.usage || 0;
    const memoryLimit = stats.memory_stats?.limit || 1;
    const memory = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

    return {
      cpu: round(cpu),
      memory: round(memory),
      memoryMb: Math.round((memoryUsage / 1024 / 1024) * 10) / 10,
    };
  } catch (error) {
    return { cpu: 0, memory: 0, memoryMb: 0 };
  }
}

export async function isContainerHealthy(container: Docker.Container): Promise<boolean> {
  try {
    const details = await container.inspect();
    const health = details.State?.Health?.Status;
    if (health === 'healthy') {
      return true;
    }
    if (health === 'unhealthy' || health === 'starting') {
      return false;
    }
    return details.State?.Status === 'running';
  } catch (error) {
    return false;
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

