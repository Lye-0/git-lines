import type { GitRunner } from './gitRunner.js';
import type { GitCommit } from './gitTypes.js';
import { gitLogFormat, parseGitLogNul } from './parsers/logParser.js';

export async function readCommits(runner: GitRunner, root: string, limit: number): Promise<GitCommit[]> {
  const output = await runner.runChecked(['log', '--all', '--topo-order', '--date-order', '--no-decorate', '-n', String(Math.max(1, limit)), `--format=${gitLogFormat(false)}`], { cwd: root, timeoutMs: 12000 });
  return parseGitLogNul(output);
}

export async function readCommit(runner: GitRunner, root: string, oid: string): Promise<GitCommit | undefined> {
  if (!/^[0-9a-f]{7,64}$/i.test(oid)) return undefined;
  const output = await runner.runChecked(['show', '-s', `--format=${gitLogFormat(true)}`, oid], { cwd: root, timeoutMs: 12000 });
  return parseGitLogNul(output)[0];
}
