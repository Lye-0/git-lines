import { describe, expect, it } from 'vitest';
import { commitChangeStats } from '../../webview/src/components/commitStatsPresentation';
import { CHANGES_COLUMN_CONTENT_WIDTH, CHANGES_COLUMN_START, CHANGES_COLUMN_WIDTH, COMMIT_CONTENT_MIN_WIDTH, TIMELINE_MIN_CONTENT_WIDTH, TIMELINE_MIN_WIDTH } from '../../webview/src/components/graphMetrics';

describe('commit row change stats', () => {
  it('normalises batched stats for the compact row', () => {
    expect(commitChangeStats({ changedFiles: 4, additions: 116, deletions: 3 })).toEqual({ files: 4, additions: 116, deletions: 3 });
    expect(commitChangeStats({ changedFiles: 0, additions: 0, deletions: 0 })).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it('does not invent stats for commits loaded without a snapshot batch', () => {
    expect(commitChangeStats({ additions: 2, deletions: 1 })).toBeUndefined();
  });

  it('defines one shared fixed column for Working Tree and commit rows', () => {
    expect(CHANGES_COLUMN_WIDTH).toBe(222);
    expect(CHANGES_COLUMN_CONTENT_WIDTH).toBe(CHANGES_COLUMN_START + CHANGES_COLUMN_WIDTH + 11);
  });

  it('keeps a minimum commit-content width for horizontal scrolling', () => {
    expect(COMMIT_CONTENT_MIN_WIDTH).toBe(320);
    expect(TIMELINE_MIN_CONTENT_WIDTH).toBe(COMMIT_CONTENT_MIN_WIDTH + CHANGES_COLUMN_WIDTH + 43);
    expect(TIMELINE_MIN_WIDTH).toBe(1150);
  });
});
