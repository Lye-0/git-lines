import type { GitRunner } from './gitRunner.js';
import type { GitRef } from './gitTypes.js';
import { parseRefRecords, refFormat } from './parsers/refParser.js';

export async function readRefs(runner: GitRunner, root: string): Promise<GitRef[]> {
  const output = await runner.runChecked(['for-each-ref', '--sort=refname', `--format=${refFormat}`], { cwd: root, timeoutMs: 12000 });
  return parseRefRecords(output);
}
