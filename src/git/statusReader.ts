import type { GitRunner } from './gitRunner.js';
import { parsePorcelainV2, toWorkingTreeState } from './parsers/statusParser.js';

export async function readStatus(runner: GitRunner, root: string, worktreeId = root) {
  const output = await runner.runChecked(['status', '--porcelain=v2', '--branch', '-z'], { cwd: root, timeoutMs: 12000 });
  return toWorkingTreeState(root, parsePorcelainV2(output), worktreeId);
}
