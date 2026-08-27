import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitRunner } from './gitRunner.js';
import type { OperationState, RepositoryInfo } from './gitTypes.js';

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(file, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export class OperationStateReader {
  public constructor(private readonly runner: GitRunner) {}

  public async read(repository: RepositoryInfo): Promise<OperationState[]> {
    const gitPath = async (name: string): Promise<string> => {
      const value = await this.runner.runChecked(['rev-parse', '--git-path', name], {
        cwd: repository.root,
        timeoutMs: 5000,
      });
      return path.isAbsolute(value.trim()) ? value.trim() : path.resolve(repository.root, value.trim());
    };
    const states: OperationState[] = [];
    const currentHead = async (): Promise<string | undefined> => {
      try {
        return (await this.runner.runChecked(['rev-parse', 'HEAD'], { cwd: repository.root, timeoutMs: 5000 })).trim() || undefined;
      } catch {
        return undefined;
      }
    };
    const mergeHead = await readOptional(await gitPath('MERGE_HEAD'));
    if (mergeHead) {
      states.push({ type: 'merge', headOid: await currentHead(), sourceOids: mergeHead.split(/\s+/) });
    }
    const cherryPick = await readOptional(await gitPath('CHERRY_PICK_HEAD'));
    if (cherryPick) {
      states.push({ type: 'cherry-pick', headOid: await currentHead(), sourceOids: [cherryPick] });
    }
    const revert = await readOptional(await gitPath('REVERT_HEAD'));
    if (revert) {
      states.push({ type: 'revert', headOid: await currentHead(), sourceOids: [revert] });
    }
    const rebaseMerge = await gitPath('rebase-merge');
    const rebaseApply = await gitPath('rebase-apply');
    if (await exists(rebaseMerge) || await exists(rebaseApply)) {
      const head = await readOptional(await gitPath('REBASE_HEAD'));
      states.push({ type: 'rebase', headOid: await currentHead(), sourceOids: head ? [head] : [] });
    }
    return states;
  }
}
