import { promises as fs } from 'fs';
import path from 'path';

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(path, 'utf-8');
    return JSON.parse(buf) as T;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(targetPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
}
