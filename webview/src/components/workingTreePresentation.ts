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

export function linkedWorktreeBranchLabel(tree: WorkingTreeState): string {
  return tree.detached ? 'HEAD (detached)' : tree.branch ?? 'No branch';
}

/** Uses an explicit linked-worktree vocabulary so it cannot be mistaken for a branch badge. */
export function linkedWorktreeStatusLabel(tree: WorkingTreeState): string {
  if (tree.inaccessible) return 'Unavailable';
  if (tree.clean) return 'Clean';
  if (tree.conflicted > 0) return `Dirty · ${tree.conflicted} conflict${tree.conflicted === 1 ? '' : 's'}`;
  return 'Dirty';
}

export function linkedWorktreeTooltip(trees: ReadonlyArray<WorkingTreeState>): string | undefined {
  if (trees.length === 0) return undefined;
  return trees.map((tree) => [
    'Label: Linked Worktree',
    'Checked out in another worktree',
    `Branch: ${linkedWorktreeBranchLabel(tree)}`,
    `Path: ${tree.path}`,
    `Status: ${linkedWorktreeStatusLabel(tree)}`,
  ].join('\n')).join('\n\n');
}

export function operationInProgressLabel(operation: Pick<OperationState, 'type'>): string {
  const name = operation.type === 'cherry-pick'
    ? 'Cherry-pick'
    : operation.type[0].toUpperCase() + operation.type.slice(1);
  return `${name} in progress`;
}
