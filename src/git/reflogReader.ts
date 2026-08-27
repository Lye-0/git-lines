import type { GitRunner } from './gitRunner.js';
import type { ReflogEntry } from './gitTypes.js';
import { parseReflogRecords, reflogFormat } from './parsers/reflogParser.js';

export async function readReflog(runner: GitRunner, root: string, refName: string): Promise<ReflogEntry[]> {
  const output = await runner.runChecked(['reflog', 'show', `--format=${reflogFormat}`, refName], { cwd: root, timeoutMs: 12000 });
  return parseReflogRecords(output, refName);
}
