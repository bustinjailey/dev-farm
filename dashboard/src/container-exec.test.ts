import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as containerExec from './container-exec.js';
import type Docker from 'dockerode';

class MockExec extends EventEmitter {
  constructor(private output: Buffer | string) {
    super();
  }

  async start(options: any) {
    // Return a readable stream that emits data
    const stream = new EventEmitter();

    process.nextTick(() => {
      stream.emit('data', this.output);
      stream.emit('end');
    });

    return { output: this.output };
  }
}

class MockContainer {
  constructor(private execOutput: Buffer | string = Buffer.from('test output')) { }

  async exec(options: any): Promise<any> {
    return new MockExec(this.execOutput);
  }
}

describe('execInContainer', () => {
  it('executes string command in container', async () => {
    const container = new MockContainer(Buffer.from('hello world')) as unknown as Docker.Container;

    const result = await containerExec.execInContainer(container, 'echo hello');

    expect(result).toHaveProperty('output');
  });

  it('executes array command in container', async () => {
    const container = new MockContainer() as unknown as Docker.Container;

    const result = await containerExec.execInContainer(container, ['ls', '-la']);

    expect(result).toHaveProperty('output');
  });

  it('passes user option to exec', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, 'whoami', { user: 'root' });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        User: 'root',
      })
    );
  });

  it('uses default user "root" when not specified', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, 'pwd');

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        User: 'root',
      })
    );
  });

  it('passes workdir option to exec', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, 'pwd', { workdir: '/workspace' });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        WorkingDir: '/workspace',
      })
    );
  });

  it('converts env object to array format', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, 'env', {
      env: { FOO: 'bar', BAZ: 'qux' },
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Env: expect.arrayContaining(['FOO=bar', 'BAZ=qux']),
      })
    );
  });

  it('wraps string commands in bash -lc', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, 'echo test');

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['bash', '-lc', 'echo test'],
      })
    );
  });

  it('does not wrap array commands', async () => {
    const container = new MockContainer() as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execInContainer(container, ['echo', 'test']);

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['echo', 'test'],
      })
    );
  });
});

describe('execToString', () => {
  it('converts buffer output to string', async () => {
    const container = new MockContainer(Buffer.from('buffer output')) as unknown as Docker.Container;

    const result = await containerExec.execToString(container, 'test');

    expect(typeof result).toBe('string');
    expect(result).toBe('buffer output');
  });

  it('returns string output as-is', async () => {
    const container = new MockContainer('string output' as any) as unknown as Docker.Container;

    const result = await containerExec.execToString(container, 'test');

    expect(result).toBe('string output');
  });

  it('returns empty string when no output', async () => {
    const container = new MockContainer('' as any) as unknown as Docker.Container;

    // Override exec to return no output
    vi.spyOn(container, 'exec').mockResolvedValue({
      start: vi.fn().mockResolvedValue({ output: undefined }),
    } as any);

    const result = await containerExec.execToString(container, 'test');

    expect(result).toBe('');
  });

  it('handles buffer array output', async () => {
    const buffers = [Buffer.from('hello '), Buffer.from('world')];
    const container = new MockContainer() as unknown as Docker.Container;

    vi.spyOn(container, 'exec').mockResolvedValue({
      start: vi.fn().mockResolvedValue({ output: buffers }),
    } as any);

    const result = await containerExec.execToString(container, 'test');

    expect(result).toBe('hello world');
  });

  it('converts non-string/non-buffer output to string', async () => {
    const container = new MockContainer() as unknown as Docker.Container;

    vi.spyOn(container, 'exec').mockResolvedValue({
      start: vi.fn().mockResolvedValue({ output: 12345 }),
    } as any);

    const result = await containerExec.execToString(container, 'test');

    expect(result).toBe('12345');
  });

  it('passes through all exec options', async () => {
    const container = new MockContainer(Buffer.from('test')) as unknown as Docker.Container;
    const execSpy = vi.spyOn(container, 'exec');

    await containerExec.execToString(container, 'whoami', {
      user: 'root',
      workdir: '/tmp',
      env: { TEST: 'value' },
    });

    expect(execSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        User: 'root',
        WorkingDir: '/tmp',
        Env: ['TEST=value'],
      })
    );
  });
});
