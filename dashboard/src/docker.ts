import Docker from 'dockerode';

let cachedDocker: Docker | null = null;

export function getDocker(): Docker {
  if (!cachedDocker) {
    cachedDocker = new Docker();
  }
  return cachedDocker;
}

export function resetDocker(): void {
  cachedDocker = null;
}

