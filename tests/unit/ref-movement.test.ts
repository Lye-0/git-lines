import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { getRefMovementAnchor, pointForNode, routeHistoryRelations, routeRefMovements } from '../../src/layout/edgeRouter.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { GraphNode, HistoryRelation, RefMovementRelation } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, parents: string[] = [], date = 1, subject = letter): GitCommit {
  return {
    oid: oid(letter),
    parentOids: parents.map(oid),
    subject,
    authorName: 'A',
    authorDate: date,
    committerName: 'A',
    committerDate: date,
  };
}

function snapshot(partial: Partial<RepositorySnapshot> & { commits: GitCommit[]; historyEvents?: HistoryEvent[] }): RepositorySnapshot {
  const head = partial.refs?.[0]?.oid ?? partial.commits[0]?.oid;
  return {
    repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
    refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: head }],
    workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: head, branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
    operations: [],
    reflogs: [],
    historyEvents: [],
    shallowBoundaryOids: [],
    hasMore: false,
    visibleCommitCount: partial.commits.length,
    ...partial,
  };
}

function resetEvent(from: string, to: string, extras: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: `history:reset:${from}:${to}`,
    type: 'reset',
    refName: 'refs/heads/main',
    fromOid: oid(from),
    toOid: oid(to),
    timestamp: 9,
    subject: 'reset: moving to destination',
    ...extras,
  };
}

describe('ref movement overlay', () => {
  it('RM1: backward reset ghosts only the old tip', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3, 'C'), commit('b', ['a'], 2, 'B'), commit('a', [], 1, 'A')],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a', {
        removedCommitCount: 2,
        removedRangeStartOid: oid('b'),
        removedRangeEndOid: oid('c'),
      })],
    }));
    expect(facts.nodes.some((node) => node.event?.type === 'reset')).toBe(false);
    expect(facts.refMovementRelations).toEqual([expect.objectContaining({ kind: 'reset', fromOid: oid('c'), toOid: oid('a'), refName: 'refs/heads/main' })]);
    expect(facts.nodes.find((node) => node.oid === oid('c'))?.ghostRefBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.ghostRefBadges ?? []).toEqual([]);
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.refBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.ghostRefBadges ?? []).toEqual([]);
    const layout = createGraphLayout(facts, { visibleCommitCount: 3, hasMore: false });
    expect(layout.refMovementPaths).toEqual([expect.objectContaining({ kind: 'reset', sourceNodeId: `commit:${oid('c')}`, targetNodeId: `commit:${oid('a')}` })]);
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    const head = layout.nodes.find((node) => node.oid === oid('a'));
    const annotation = layout.operationAnnotationRows?.[0];
    expect(working?.row).toBeLessThan(head?.row ?? Number.MAX_SAFE_INTEGER);
    expect(annotation?.row).toBeGreaterThan(working?.row ?? -1);
    expect(facts.edges.find((edge) => edge.type === 'working-tree')?.toNodeId).toBe(head?.id);
  });

  it('RM2: forward ref movement keeps from → to direction', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [resetEvent('a', 'c')],
    }));
    expect(facts.refMovementRelations?.[0]).toMatchObject({ fromOid: oid('a'), toOid: oid('c') });
    const layout = createGraphLayout(facts, { visibleCommitCount: 3, hasMore: false });
    const path = layout.refMovementPaths?.[0];
    const from = layout.nodes.find((node) => node.oid === oid('a'))!;
    const to = layout.nodes.find((node) => node.oid === oid('c'))!;
    expect(path?.sourceNodeId).toBe(from.id);
    expect(path?.targetNodeId).toBe(to.id);
    const fromAnchor = getRefMovementAnchor(from, to);
    const start = path?.d.match(/-?\d+(?:\.\d+)?/g)?.slice(0, 2).map(Number);
    expect(start?.[0]).toBeGreaterThan(pointForNode(from).x);
    expect(Math.abs((start?.[1] ?? 0) - fromAnchor.y)).toBeLessThan(6);
  });

  it('RM3: old commit stays live when another ref still points at it', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') },
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('c') },
      ],
      historyEvents: [resetEvent('c', 'a')],
    }));
    const old = facts.nodes.find((node) => node.oid === oid('c'));
    expect(old?.kind).toBe('commit');
    expect(old?.previousRoute).toBe(false);
    expect(old?.refBadges?.map((badge) => badge.name)).toEqual(['feature']);
    expect(old?.ghostRefBadges?.map((badge) => badge.name)).toEqual(['main']);
  });

  it('RM4: removed-range strikethrough does not add intermediate ghost badges', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a', {
        removedCommitCount: 2,
        removedRangeStartOid: oid('b'),
        removedRangeEndOid: oid('c'),
      })],
    }));
    expect(facts.refMovementRelations?.[0]?.removedCommitCount).toBe(2);
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.ghostRefBadges ?? []).toEqual([]);
  });

  it('RM5: branch move reuses reset geometry with a different operation name', () => {
    const events: HistoryEvent[] = [{
      id: 'history:branch-move:a:c',
      type: 'branch-move',
      refName: 'refs/heads/main',
      fromOid: oid('a'),
      toOid: oid('c'),
      timestamp: 4,
      subject: 'branch: Reset to c',
    }];
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: events,
    }));
    expect(facts.refMovementRelations).toEqual([expect.objectContaining({ kind: 'branch-move', fromOid: oid('a'), toOid: oid('c') })]);
    const resetFacts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [resetEvent('a', 'c')],
    }));
    const moveLayout = createGraphLayout(facts, { visibleCommitCount: 3, hasMore: false });
    const resetLayout = createGraphLayout(resetFacts, { visibleCommitCount: 3, hasMore: false });
    expect(moveLayout.refMovementPaths?.[0]?.d.replace(/[0-9.]+/g, '#')).toBe(resetLayout.refMovementPaths?.[0]?.d.replace(/[0-9.]+/g, '#'));
    expect(moveLayout.refMovementPaths?.[0]?.kind).toBe('branch-move');
    expect(resetLayout.refMovementPaths?.[0]?.kind).toBe('reset');
  });

  it('RM6: chained movements keep two relations and ghost the intermediate position', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [resetEvent('a', 'b'), resetEvent('b', 'c', { id: 'history:reset:b:c', timestamp: 10 })],
    }));
    expect(facts.refMovementRelations).toHaveLength(2);
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.ghostRefBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.ghostRefBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(facts.nodes.find((node) => node.oid === oid('c'))?.refBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(facts.nodes.find((node) => node.oid === oid('c'))?.ghostRefBadges ?? []).toEqual([]);
  });

  it('RM7: opposite reset and branch-move are not collapsed', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [
        { id: 'history:branch-move:b:c', type: 'branch-move', refName: 'refs/heads/main', fromOid: oid('b'), toOid: oid('c'), timestamp: 11, subject: 'branch: Reset to c' },
        resetEvent('c', 'b', { timestamp: 10 }),
      ],
    }));
    expect(facts.refMovementRelations).toEqual([
      expect.objectContaining({ kind: 'branch-move', fromOid: oid('b'), toOid: oid('c') }),
      expect.objectContaining({ kind: 'reset', fromOid: oid('c'), toOid: oid('b') }),
    ]);
    expect(facts.refMovementRelations).toHaveLength(2);
  });

  it('RM8: Reflog OFF drops ghost badges, curves, and annotation rows', () => {
    const hidden = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a')],
    }), { showReflog: false });
    expect(hidden.refMovementRelations).toEqual([]);
    expect(hidden.nodes.some((node) => (node.ghostRefBadges?.length ?? 0) > 0)).toBe(false);
    expect(hidden.nodes.find((node) => node.oid === oid('a'))?.refBadges?.map((badge) => badge.name)).toEqual(['main']);
    const layout = createGraphLayout(hidden, { visibleCommitCount: 3, hasMore: false });
    expect(layout.refMovementPaths).toEqual([]);
    expect(layout.operationAnnotationRows).toEqual([]);
  });

  it('RM9: no-op fromOid === toOid is not an overlay', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('a')],
      historyEvents: [resetEvent('a', 'a')],
    }));
    expect(facts.refMovementRelations).toEqual([]);
    expect(facts.nodes.some((node) => node.event?.type === 'reset')).toBe(false);
  });

  it('RM10: missing pagination endpoint does not invent a curve', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('a')],
      visibleCommitCount: 1,
      historyEvents: [resetEvent('c', 'a')],
    }));
    expect(facts.refMovementRelations).toEqual([]);
    const layout = createGraphLayout(facts, { visibleCommitCount: 1, hasMore: true });
    expect(layout.refMovementPaths).toEqual([]);
  });

  it('RM11: Working Tree still connects directly to current HEAD', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a')],
    }));
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    const head = facts.nodes.find((node) => node.oid === oid('a'));
    expect(facts.edges.find((edge) => edge.type === 'working-tree')).toMatchObject({ fromNodeId: working?.id, toNodeId: head?.id });
    const layout = createGraphLayout(facts, { visibleCommitCount: 2, hasMore: false });
    expect(layout.edgePaths?.some((path) => path.id === `working:${working?.workingTree?.worktreeId}:${head?.id}`)).toBe(true);
  });

  it('RM12: Amend / Cherry-pick / Revert routing is unchanged beside a reset overlay', () => {
    const source: GraphNode = { id: 'commit:s', kind: 'commit', oid: oid('s'), refIds: [], row: 2, lane: 1 };
    const target: GraphNode = { id: 'commit:n', kind: 'commit', oid: oid('n'), refIds: [], row: 0, lane: 0 };
    const amend: HistoryRelation = { id: 'amend:one', kind: 'amend', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
    const cherry: HistoryRelation = { id: 'cherry:one', kind: 'cherry-pick', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
    const revert: HistoryRelation = { id: 'revert:one', kind: 'revert', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
    const movement: RefMovementRelation = { id: 'reset:one', kind: 'reset', refName: 'refs/heads/main', fromOid: source.oid!, toOid: target.oid!, timestamp: 1, evidence: 'reflog' };
    const history = routeHistoryRelations([source, target], [amend, cherry, revert]);
    const moved = routeRefMovements([source, target], [movement]);
    expect(history.map((path) => path.kind)).toEqual(['amend', 'cherry-pick', 'revert']);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.kind).toBe('reset');
    expect(history[0]?.d).not.toBe(moved[0]?.d);
  });
});
