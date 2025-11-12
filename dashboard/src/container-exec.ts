import type Docker from 'dockerode';

export interface ExecOptions {
  user?: string;
  workdir?: string;
  env?: Record<string, string>;
}

export async function execInContainer(
  container: Docker.Container,
  command: string | string[],
  options: ExecOptions = {}
): Promise<{ output?: unknown }> {
  const { user = 'coder', workdir, env } = options;

  const cmd = Array.isArray(command) ? command : ['bash', '-lc', command];

  const exec = await container.exec({
    Cmd: cmd,
    User: user,
    WorkingDir: workdir,
    Env: env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : undefined,
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: false, stdin: false });
  
  // Read the stream data
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve({ output: Buffer.concat(chunks) }));
    stream.on('error', reject);
  });
}

export async function execToString(
  container: Docker.Container,
  command: string | string[],
  options: ExecOptions = {}
): Promise<string> {
  const result = await execInContainer(container, command, options);
  if (!result.output) {
    return '';
  }

  if (Buffer.isBuffer(result.output)) {
    return result.output.toString('utf-8');
  }

  if (typeof result.output === 'string') {
    return result.output;
  }

  if (Array.isArray(result.output)) {
    return Buffer.concat(result.output as Buffer[]).toString('utf-8');
  }

  return String(result.output);
}
