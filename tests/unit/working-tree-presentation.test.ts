import { describe, expect, it } from 'vitest';
import type { WorkingTreeState } from '../../src/git/gitTypes.js';
import { operationInProgressLabel, summarizeWorkingTree, workingTreeStateLabel } from '../../webview/src/components/workingTreePresentation';

const tree = (overrides: Partial<WorkingTreeState> = {}): WorkingTreeState => ({
  worktreeId: 'worktree-0',
  path: 'C:/repo',
  detached: false,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  clean: true,
  ...overrides,
});

describe('working tree summary presentation', () => {
  it('uses Git diff stats and unique status file count', () => {
    expect(summarizeWorkingTree(tree({ clean: false, changedFiles: 3, additions: 142, deletions: 1 }))).toEqual({ files: 3, additions: 142, deletions: 1, clean: false, inaccessible: false });
  });

  it('falls back to status counts for older protocol data', () => {
    expect(summarizeWorkingTree(tree({ clean: false, staged: 1, unstaged: 2, untracked: 1, conflicted: 1 }))).toMatchObject({ files: 5 });
  });

  it('keeps clean, conflict and generic change labels concise', () => {
    expect(workingTreeStateLabel(tree())).toBe('Clean');
    expect(workingTreeStateLabel(tree({ clean: false, conflicted: 1 }))).toBe('1 conflict');
    expect(workingTreeStateLabel(tree({ clean: false, conflicted: 1, changedFiles: 2 }))).toBe('1 conflict · Changes');
    expect(workingTreeStateLabel(tree({ clean: false, unstaged: 1 }))).toBe('Changes');
  });

  it('uses readable labels for every in-progress operation', () => {
    expect(operationInProgressLabel({ type: 'merge' })).toBe('Merge in progress');
    expect(operationInProgressLabel({ type: 'cherry-pick' })).toBe('Cherry-pick in progress');
    expect(operationInProgressLabel({ type: 'rebase' })).toBe('Rebase in progress');
    expect(operationInProgressLabel({ type: 'revert' })).toBe('Revert in progress');
  });
});
