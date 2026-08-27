import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitRunner } from './gitRunner.js';

export async function readShallowBoundaries(runner: GitRunner, root: string): Promise<string[]> {
  try {
    const value = await runner.runChecked(['rev-parse', '--git-path', 'shallow'], { cwd: root, timeoutMs: 5000 });
    const file = path.isAbsolute(value.trim()) ? value.trim() : path.resolve(root, value.trim());
    return (await fs.readFile(file, 'utf8')).split(/\r?\n/).filter((oid) => /^[0-9a-f]{7,64}$/i.test(oid));
  } catch {
    return [];
  }
}
