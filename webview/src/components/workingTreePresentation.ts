import type { WorkingTreeState } from '../../../src/git/gitTypes';

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
  if (tree.conflicted > 0) return `${tree.conflicted} conflict${tree.conflicted === 1 ? '' : 's'}`;
  return tree.clean ? 'Clean' : 'Changes';
}
