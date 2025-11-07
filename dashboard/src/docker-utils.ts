import type Docker from 'dockerode';
import type { ContainerStats } from './types.js';
import { getContainerLogs } from './system.js';

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

export async function isContainerHealthy(container: Docker.Container, docker?: Docker): Promise<boolean> {
  try {
    const details = await container.inspect();

    // If container has health check, use it
    const health = details.State?.Health?.Status;
    if (health === 'healthy') {
      return true;
    }
    if (health === 'unhealthy' || health === 'starting') {
      return false;
    }

    // For containers without health checks, verify tunnel process is running
    if (details.State?.Status === 'running') {
      try {
        // Check if VS Code tunnel process is running
        const exec = await container.exec({
          Cmd: ['pgrep', '-f', 'code-insiders tunnel'],
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await exec.start({ hijack: false });
        const output = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const readable = stream as unknown as NodeJS.ReadableStream;
          readable.on('data', (chunk: Buffer) => chunks.push(chunk));
          readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          readable.on('error', reject);
        });
        // If pgrep finds the process, it returns the PID (non-empty output)
        const processRunning = output.trim().length > 0;

        if (!processRunning) {
          return false;
        }

        // Process is running, but we need to check if auth is required and complete
        if (docker) {
          try {
            const logs = await getContainerLogs(docker, details.Id, 100);
            const authMatch = logs.match(/log into (https:\/\/[^\s]+) and use code ([A-Z0-9-]+)/);

            // If auth is required, check if it's complete
            if (authMatch) {
              const tunnelReady = logs.includes('Open this link in your browser');
              // Auth required but not complete - keep in "starting" state
              if (!tunnelReady) {
                return false;
              }
            }
            // Either no auth required, or auth is complete
            return true;
          } catch {
            // If we can't read logs, assume process running = healthy
            return true;
          }
        }

        return true;
      } catch {
        // If exec fails, assume still starting
        return false;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

