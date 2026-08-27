import path from 'node:path';
import type { GitRunner } from '../git/gitRunner.js';
import type { RepositoryInfo } from '../git/gitTypes.js';

function resolveGitPath(root: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

export class RepositoryDiscovery {
  public constructor(private readonly runner: GitRunner) {}

  public async discover(cwd: string): Promise<RepositoryInfo> {
    const run = (args: string[]) => this.runner.runChecked(args, { cwd, timeoutMs: 8000 });
    const root = path.normalize((await run(['rev-parse', '--show-toplevel'])).trim());
    const [gitDirValue, commonDirValue, bareValue, shallowValue] = await Promise.all([
      run(['rev-parse', '--git-dir']),
      run(['rev-parse', '--git-common-dir']),
      run(['rev-parse', '--is-bare-repository']),
      run(['rev-parse', '--is-shallow-repository']),
    ]);
    const gitDir = resolveGitPath(root, gitDirValue.trim());
    const commonGitDir = resolveGitPath(root, commonDirValue.trim());
    return {
      root,
      gitDir,
      commonGitDir,
      bare: bareValue.trim() === 'true',
      shallow: shallowValue.trim() === 'true',
      linkedWorktree: path.normalize(gitDir) !== path.normalize(commonGitDir),
    };
  }
}
