import type { OperationState, WorkingTreeState } from '../../../src/git/gitTypes';

export interface WorkingTreeSummary {
  files: number;
  additions: number;
  deletions: number;
  clean: boolean;
  inaccessible: boolean;
}

export function summarizeWorkingTree(tree: WorkingTreeState): WorkingTreeSummary {
  return {
    files: tree.changedFiles ?? tree.staged + tree.unstaged + tree.untracked + tree.conflicted,
    additions: tree.additions ?? 0,
    deletions: tree.deletions ?? 0,
    clean: tree.clean,
    inaccessible: Boolean(tree.inaccessible),
  };
}

export function workingTreeStateLabel(tree: WorkingTreeState): string {
  if (tree.inaccessible) return 'Status unavailable';
  if (tree.conflicted > 0) {
    const conflicts = `${tree.conflicted} conflict${tree.conflicted === 1 ? '' : 's'}`;
    const additionalChanges = tree.staged + tree.unstaged + tree.untracked > 0
      || (tree.changedFiles !== undefined && tree.changedFiles > tree.conflicted);
    return additionalChanges ? `${conflicts} · Changes` : conflicts;
  }
  return tree.clean ? 'Clean' : 'Changes';
}

export function operationInProgressLabel(operation: Pick<OperationState, 'type'>): string {
  const name = operation.type === 'cherry-pick'
    ? 'Cherry-pick'
    : operation.type[0].toUpperCase() + operation.type.slice(1);
  return `${name} in progress`;
}
