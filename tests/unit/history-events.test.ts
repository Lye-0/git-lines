import { describe, expect, it } from 'vitest';
import { countCommitsBetween, resolveHistoryEvents } from '../../src/model/historyEventResolver.js';
import type { GitCommit, ReflogEntry } from '../../src/git/gitTypes.js';

const oid = (letter: string) => letter.repeat(40);
const commits: GitCommit[] = [
  { oid: oid('a'), parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
  { oid: oid('b'), parentOids: [oid('a')], subject: 'feature', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
];
const entry = (subject: string, from: string, to: string, refName = 'refs/heads/main', selector = 'main@{0}', timestamp = 3): ReflogEntry => ({ refName, newOid: to, previousOid: from, selector, timestamp, subject });

function commit(oidValue: string, parentOids: string[], date: number): GitCommit {
  return { oid: oid(oidValue), parentOids, subject: oidValue, authorName: 'A', authorDate: date, committerName: 'A', committerDate: date };
}

describe('history event resolver', () => {
  it('only calls a ref move fast-forward when the reflog says so and ancestry proves it', () => {
    expect(resolveHistoryEvents([entry('merge feature: Fast-forward', oid('a'), oid('b'))], commits)[0]).toMatchObject({
      type: 'fast-forward',
      commitCount: 1,
      operation: 'merge',
      rawReflogMessage: 'merge feature: Fast-forward',
    });
    expect(resolveHistoryEvents([entry('update', oid('b'), oid('a'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('fetch: fast-forward', oid('a'), oid('b'), 'refs/remotes/origin/main')], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: fast-forward docs', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: merge notes: Fast-forward', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: force update notes', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: document commit --amend behavior', oid('a'), oid('b'))], commits)).toEqual([]);
    expect(resolveHistoryEvents([entry('commit: branch -f docs', oid('a'), oid('b'))], commits)).toEqual([]);
  });

  it('counts every commit in old..new, including side parents of a merge ancestor', () => {
    const side = commit('s', [oid('a')], 2);
    const merge = commit('m', [oid('b'), side.oid], 3);
    const tip = commit('c', [merge.oid], 4);
    expect(countCommitsBetween(oid('a'), tip.oid, [...commits, side, merge, tip])).toBe(4);
    expect(countCommitsBetween(oid('b'), tip.oid, [...commits, side, merge, tip])).toBe(3);
    expect(countCommitsBetween(oid('a'), oid('a'), commits)).toBe(0);
    expect(countCommitsBetween(oid('missing'), oid('b'), commits)).toBeUndefined();
  });

  it('formats pull and operation-less fast-forward events without guessing an operation', () => {
    const pull = resolveHistoryEvents([entry('pull origin/main: Fast-forward', oid('a'), oid('b'))], commits)[0];
    expect(pull).toMatchObject({ type: 'fast-forward', commitCount: 1, operation: 'pull' });

    const explicit = resolveHistoryEvents([entry('Fast-forward', oid('a'), oid('b'))], commits)[0];
    expect(explicit).toMatchObject({ type: 'fast-forward', commitCount: 1, rawReflogMessage: 'Fast-forward' });
    expect(explicit?.operation).toBeUndefined();
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

  it('records the exact removed range only for a proven backward reset', () => {
    const chain = [
      commit('a', [], 1),
      commit('b', [oid('a')], 2),
      commit('c', [oid('b')], 3),
      commit('d', [oid('c')], 4),
    ];
    const backward = resolveHistoryEvents([
      entry('reset: moving to HEAD~3', oid('d'), oid('a'), 'refs/heads/main', 'main@{0}', 5),
    ], chain)[0];
    expect(backward).toMatchObject({
      type: 'reset',
      removedCommitCount: 3,
      removedRangeStartOid: oid('b'),
      removedRangeEndOid: oid('d'),
    });

    const forward = resolveHistoryEvents([
      entry('reset: moving to d', oid('a'), oid('d'), 'refs/heads/main', 'main@{0}', 6),
    ], chain)[0];
    expect(forward).toBeDefined();
    expect(forward?.removedCommitCount).toBeUndefined();
    expect(forward?.removedRangeStartOid).toBeUndefined();
    expect(forward?.removedRangeEndOid).toBeUndefined();
  });

  it('uses reflog selector order to break same-timestamp event ties', () => {
    const events = resolveHistoryEvents([
      entry('reset: moving to a', oid('b'), oid('a'), 'refs/heads/main', 'main@{1}', 5),
      entry('branch: move to b', oid('a'), oid('b'), 'refs/heads/main', 'main@{0}', 5),
    ], commits);
    expect(events.map((event) => event.type)).toEqual(['branch-move', 'reset']);
    expect(events.map((event) => event.reflogIndex)).toEqual([0, 1]);
  });

  it('keeps only the completed branch rebase movement and drops internal HEAD entries', () => {
    const oldTip = commit('o', [oid('a')], 2);
    const replayBase = commit('c', [oid('a')], 3);
    const newTip = commit('n', [replayBase.oid], 4);
    const events = resolveHistoryEvents([
      entry('rebase (finish): refs/heads/feature onto ' + replayBase.oid, oldTip.oid, newTip.oid, 'refs/heads/feature', 'feature@{0}', 5_000),
      entry('rebase (finish): returning to refs/heads/feature', replayBase.oid, newTip.oid, 'HEAD', 'HEAD@{0}', 5_000),
      entry('rebase (continue): feature change', replayBase.oid, newTip.oid, 'HEAD', 'HEAD@{1}', 4_999),
      entry('rebase (start): checkout main', oldTip.oid, replayBase.oid, 'HEAD', 'HEAD@{2}', 4_998),
    ], [...commits, oldTip, replayBase, newTip]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'rebase',
      refName: 'refs/heads/feature',
      fromOid: oldTip.oid,
      toOid: newTip.oid,
      boundaryOid: replayBase.oid,
      eventStartOid: newTip.oid,
      rawReflogMessage: 'rebase (finish): refs/heads/feature onto ' + replayBase.oid,
    });
  });

  it('classifies completed cherry-pick and revert movements and puts their boundaries at the new commit parent', () => {
    const sourceOid = '1'.repeat(40);
    const cherryPick = { ...commit('c', [oid('b')], 4), body: 'source change\n\n(cherry picked from commit ' + sourceOid + ')\n' };
    const reverted = { ...commit('d', [cherryPick.oid], 5), body: 'Revert "source change"\n\nThis reverts commit ' + oid('b') + '.\n' };
    const events = resolveHistoryEvents([
      entry('commit (cherry-pick): source change', oid('b'), cherryPick.oid, 'refs/heads/main', 'main@{0}', 6_000),
      entry('commit (cherry-pick): source change', oid('b'), cherryPick.oid, 'HEAD', 'HEAD@{0}', 6_000),
      entry('commit: Revert "source change"', cherryPick.oid, reverted.oid, 'refs/heads/main', 'main@{0}', 7_000),
    ], [...commits, cherryPick, reverted]);

    expect(events).toHaveLength(2);
    expect(events.find((event) => event.type === 'cherry-pick')).toMatchObject({
      refName: 'refs/heads/main',
      fromOid: oid('b'),
      toOid: cherryPick.oid,
      boundaryOid: oid('b'),
      eventStartOid: cherryPick.oid,
      sourceOid,
      affectedRefs: ['refs/heads/main'],
    });
    expect(events.find((event) => event.type === 'revert')).toMatchObject({
      refName: 'refs/heads/main',
      fromOid: cherryPick.oid,
      toOid: reverted.oid,
      boundaryOid: cherryPick.oid,
      eventStartOid: reverted.oid,
      targetOid: oid('b'),
    });
  });

  it('keeps cherry-pick and revert events when their bodies do not contain explicit source evidence', () => {
    const cherryPick = { ...commit('e', [oid('b')], 4), body: 'source change without -x\n' };
    const reverted = { ...commit('f', [cherryPick.oid], 5), body: 'Revert "source change"\n\nNo standard target marker.\n' };
    const events = resolveHistoryEvents([
      entry('commit (cherry-pick): source change', oid('b'), cherryPick.oid, 'refs/heads/main', 'main@{0}', 6_000),
      entry('commit: Revert "source change"', cherryPick.oid, reverted.oid, 'refs/heads/main', 'main@{0}', 7_000),
    ], [...commits, cherryPick, reverted]);

    expect(events).toHaveLength(2);
    expect(events.find((event) => event.type === 'cherry-pick')).toMatchObject({ toOid: cherryPick.oid });
    expect(events.find((event) => event.type === 'cherry-pick')?.sourceOid).toBeUndefined();
    expect(events.find((event) => event.type === 'revert')).toMatchObject({ toOid: reverted.oid });
    expect(events.find((event) => event.type === 'revert')?.targetOid).toBeUndefined();
  });

  it('resolves an explicit branch rename even though the branch keeps the same commit OID', () => {
    const renameSubject = 'Branch: renamed refs/heads/feature to refs/heads/feature-renamed';
    const events = resolveHistoryEvents([
      entry(renameSubject, oid('b'), oid('b'), 'HEAD', 'HEAD@{0}', 8_000),
      entry(renameSubject, oid('b'), oid('b'), 'refs/heads/feature-renamed', 'feature-renamed@{0}', 8_000),
    ], commits);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'branch-rename',
      refName: 'refs/heads/feature-renamed',
      toOid: oid('b'),
      eventStartOid: oid('b'),
      operation: 'Branch rename',
      fromRef: 'refs/heads/feature',
      toRef: 'refs/heads/feature-renamed',
      rawReflogMessage: renameSubject,
      affectedRefs: ['refs/heads/feature-renamed', 'HEAD'],
    });
    expect(events[0]?.fromOid).toBeUndefined();
  });

  it('does not infer a branch rename from a commit subject', () => {
    const subject = 'commit: Branch: renamed refs/heads/feature to refs/heads/feature-renamed';
    expect(resolveHistoryEvents([entry(subject, oid('a'), oid('b'))], commits)).toEqual([]);
  });

  it('does not expose an unfinished rebase start as a user-facing history event', () => {
    const events = resolveHistoryEvents([
      entry('rebase (start): checkout main', oid('b'), oid('a'), 'HEAD'),
    ], commits);
    expect(events).toEqual([]);
  });

  it('does not duplicate ordinary commit creation in the reflog overlay', () => {
    expect(resolveHistoryEvents([entry('commit: feature', oid('a'), oid('b'))], commits)).toEqual([]);
  });
});
