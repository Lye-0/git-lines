import { describe, expect, it } from 'vitest';
import { commitChangeStats } from '../../webview/src/components/commitStatsPresentation';

describe('commit row change stats', () => {
  it('normalises batched stats for the compact row', () => {
    expect(commitChangeStats({ changedFiles: 4, additions: 116, deletions: 3 })).toEqual({ files: 4, additions: 116, deletions: 3 });
    expect(commitChangeStats({ changedFiles: 0, additions: 0, deletions: 0 })).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it('does not invent stats for commits loaded without a snapshot batch', () => {
    expect(commitChangeStats({ additions: 2, deletions: 1 })).toBeUndefined();
  });
});
