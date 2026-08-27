import type { GitRunner } from './gitRunner.js';
import { parseWorktreePorcelain } from './parsers/worktreeParser.js';

export async function readWorktrees(runner: GitRunner, root: string) {
  const output = await runner.runChecked(['worktree', 'list', '--porcelain'], { cwd: root, timeoutMs: 12000 });
  return parseWorktreePorcelain(output);
}
