import { describe, expect, it } from 'vitest';
import type { GitCommitDetail } from '../../src/git/gitTypes.js';
import { commitDescription, detailFileChanges, resolveDetailRefBadges, shortHash } from '../../webview/src/components/detailPresentation';

const detail = (body?: string): GitCommitDetail => ({
  oid: 'abcdef0123456789',
  parentOids: ['1234567890abcdef'],
  subject: 'Improve graph',
  body,
  authorName: 'Git Lines',
  authorDate: 0,
  committerName: 'Git Lines',
  committerDate: 0,
  files: ['README.md'],
  additions: 2,
  deletions: 1,
});

describe('commit detail presentation', () => {
  it('uses a compact hash and keeps legacy file lists usable', () => {
    expect(shortHash('abcdef0123456789')).toBe('abcdef01');
    expect(detailFileChanges(detail())).toEqual([{ path: 'README.md', status: 'M' }]);
  });

  it('resolves the same ref badges and track colors used by the graph', () => {
    const badges = resolveDetailRefBadges({ refBadges: [
      { fullName: 'refs/heads/main', name: 'main', kind: 'local', isDefault: true },
      { fullName: 'refs/remotes/origin/main', name: 'origin/main', kind: 'remote' },
      { fullName: 'refs/tags/v1.0.0', name: 'v1.0.0', kind: 'tag' },
    ] }, [
      { refNames: ['refs/heads/main'], color: '#5cc8ff' },
      { refNames: ['refs/remotes/origin/main'], color: '#5cc8ff' },
    ]);
    expect(badges).toMatchObject([
      { name: 'main', isDefault: true, color: '#5cc8ff' },
      { name: 'origin/main', color: '#5cc8ff' },
      { name: 'v1.0.0', color: undefined },
    ]);
    expect(resolveDetailRefBadges(undefined, [])).toEqual([]);
  });

  it('hides a body that only repeats the subject', () => {
    expect(commitDescription(detail('Improve graph'))).toBeUndefined();
    expect(commitDescription(detail('Improve graph\n'))).toBeUndefined();
    expect(commitDescription(detail('Improve graph\n\nImprove graph'))).toBeUndefined();
  });

  it('returns only additional body text when the subject is included', () => {
    expect(commitDescription(detail('Improve graph\n\nDetails about the change.'))).toBe('Details about the change.');
    expect(commitDescription(detail('A separately written body'))).toBe('A separately written body');
  });
});
