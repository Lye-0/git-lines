import { describe, expect, it } from 'vitest';
import { resolveHistoryEvents } from '../../src/model/historyEventResolver.js';
import type { GitCommit, ReflogEntry } from '../../src/git/gitTypes.js';

const oid = (letter: string) => letter.repeat(40);
const commits: GitCommit[] = [
  { oid: oid('a'), parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
  { oid: oid('b'), parentOids: [oid('a')], subject: 'feature', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
];
const entry = (subject: string, from: string, to: string, refName = 'refs/heads/main', selector = 'main@{0}', timestamp = 3): ReflogEntry => ({ refName, newOid: to, previousOid: from, selector, timestamp, subject });

describe('history event resolver', () => {
  it('only calls a ref move fast-forward when the reflog says so and ancestry proves it', () => {
    expect(resolveHistoryEvents([entry('merge feature: Fast-forward', oid('a'), oid('b'))], commits)[0].type).toBe('fast-forward');
    expect(resolveHistoryEvents([entry('update', oid('b'), oid('a'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('fetch: fast-forward', oid('a'), oid('b'), 'refs/remotes/origin/main')], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: fast-forward docs', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: merge notes: Fast-forward', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: force update notes', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: document commit --amend behavior', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: branch -f docs', oid('a'), oid('b'))], commits)).toEqual([]);
  });

  it('never labels a multi-parent merge commit itself as fast-forward', () => {
    const mergeCommit: GitCommit = { oid: oid('m'), parentOids: [oid('a'), oid('b')], subject: 'merge', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 };
    expect(resolveHistoryEvents([entry('merge feature: Fast-forward', oid('a'), oid('m'))], [...commits, mergeCommit])).toEqual([]);
  });

  it('coalesces HEAD and branch reflogs from one pull into one logical event', () => {
    const events = resolveHistoryEvents([
      entry('pull --tags origin main: Fast-forward', oid('a'), oid('b'), 'HEAD', 'HEAD@{0}'),
      entry('pull --tags origin main: Fast-forward', oid('a'), oid('b'), 'refs/heads/main', 'main@{0}'),
      entry('fetch: fast-forward', oid('a'), oid('b'), 'refs/remotes/origin/main', 'origin/main@{0}'),
    ], commits);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fast-forward', refName: 'refs/heads/main', affectedRefs: ['refs/heads/main', 'HEAD'] });
  });

  it('keeps one event identity when refs are recorded at different times', () => {
    const events = resolveHistoryEvents([
      entry('pull origin main: Fast-forward', oid('a'), oid('b'), 'HEAD', 'HEAD@{0}', 3000),
      entry('merge main: Fast-forward', oid('a'), oid('b'), 'refs/heads/main', 'main@{0}', 4000),
    ], commits);
    expect(events).toHaveLength(1);
    expect(events[0]?.timestamp).toBe(4000);
    expect(events[0]?.id).toBe(`history:fast-forward:4000:${oid('b')}`);
  });

  it('classifies explicit reset/amend/rebase actions without guessing from patch similarity', () => {
    expect(resolveHistoryEvents([entry('reset: moving to HEAD~1', oid('b'), oid('a'))], commits)[0].type).toBe('reset');
    expect(resolveHistoryEvents([entry('commit (amend): fix', oid('a'), oid('b'))], commits)[0].type).toBe('amend');
    expect(resolveHistoryEvents([entry('rebase (finish): refs/heads/main', oid('b'), oid('a'))], commits)[0].type).toBe('rebase');
  });

  it('does not duplicate ordinary commit creation in the reflog overlay', () => {
    expect(resolveHistoryEvents([entry('commit: feature', oid('a'), oid('b'))], commits)).toEqual([]);
  });
});
