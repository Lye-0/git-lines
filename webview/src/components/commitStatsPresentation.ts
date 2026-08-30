import type { GitCommit } from '../../../src/git/gitTypes';
import type { ChangeStats } from './changeStats';

export type CommitChangeStats = ChangeStats;

/**
 * Normalises optional snapshot statistics for the compact graph-row display.
 * A missing `changedFiles` means that the commit was loaded outside the
 * snapshot stats batch (for example a reflog-only object), so it is kept
 * hidden rather than presenting an invented zero.
 */
export function commitChangeStats(commit: Pick<GitCommit, 'changedFiles' | 'additions' | 'deletions'> | undefined): CommitChangeStats | undefined {
  if (commit?.changedFiles === undefined) return undefined;
  return {
    files: Math.max(0, commit.changedFiles),
    additions: Math.max(0, commit.additions ?? 0),
    deletions: Math.max(0, commit.deletions ?? 0),
  };
}
