import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { GraphNode, HistoryRelation } from '../../src/model/graphModel.js';
import { graphSideRefEndpoints, messageSideGhostRefBadges, messageSideRefBadges } from '../../webview/src/components/refMovementPresentation';

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

function endpointsFor(facts: ReturnType<typeof buildGraphFacts>) {
  return graphSideRefEndpoints(facts.nodes, facts.refMovementRelations ?? []);
}

function node(facts: ReturnType<typeof buildGraphFacts>, letter: string) {
  return facts.nodes.find((candidate) => candidate.oid === oid(letter))!;
}

describe('ref movement graph-side badges', () => {
  it('V1: old tip is the only ghost endpoint badge', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3, 'three'), commit('b', ['a'], 2, 'two'), commit('a', [], 1, 'one')],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a', { removedCommitCount: 2, removedRangeStartOid: oid('b'), removedRangeEndOid: oid('c') })],
    }));
    const endpoints = endpointsFor(facts);
    expect(endpoints.filter((endpoint) => endpoint.ghost)).toEqual([
      expect.objectContaining({ oid: oid('c'), badge: expect.objectContaining({ name: 'main' }), ghost: true }),
    ]);
  });

  it('V2: intermediate commit has no ghost endpoint badge', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a', { removedCommitCount: 2, removedRangeStartOid: oid('b'), removedRangeEndOid: oid('c') })],
    }));
    expect(endpointsFor(facts).some((endpoint) => endpoint.oid === oid('b'))).toBe(false);
    expect(node(facts, 'b').ghostRefBadges ?? []).toEqual([]);
  });

  it('V3: current and ghost main are not duplicated on the message side', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a')],
    }));
    const relations = facts.refMovementRelations ?? [];
    const names = (candidate: GraphNode) => new Set(graphSideRefEndpoints([candidate], relations).map((endpoint) => endpoint.badge.fullName));
    const current = node(facts, 'a');
    const old = node(facts, 'c');
    expect(endpointsFor(facts).find((endpoint) => endpoint.oid === oid('a'))).toMatchObject({ ghost: false, badge: { name: 'main' } });
    expect(messageSideRefBadges(current, names(current)).map((badge) => badge.name)).toEqual([]);
    expect(messageSideGhostRefBadges(current, names(current))).toEqual([]);
    expect(messageSideRefBadges(old, names(old))).toEqual([]);
    expect(messageSideGhostRefBadges(old, names(old))).toEqual([]);
  });

  it('V4: opposite movements keep current vs ghost main', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [
        { id: 'history:branch-move:b:c', type: 'branch-move', refName: 'refs/heads/main', fromOid: oid('b'), toOid: oid('c'), timestamp: 11, subject: 'branch: Reset to c' },
        resetEvent('c', 'b', { timestamp: 10 }),
      ],
    }));
    const endpoints = endpointsFor(facts);
    expect(endpoints.find((endpoint) => endpoint.oid === oid('c'))).toMatchObject({ ghost: false, badge: { name: 'main' } });
    expect(endpoints.find((endpoint) => endpoint.oid === oid('b'))).toMatchObject({ ghost: true, badge: { name: 'main' } });
  });

  it('V5: Reset and Branch move stay two independent relations', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      historyEvents: [
        { id: 'history:branch-move:b:c', type: 'branch-move', refName: 'refs/heads/main', fromOid: oid('b'), toOid: oid('c'), timestamp: 11, subject: 'branch: Reset to c' },
        resetEvent('c', 'b', { timestamp: 10 }),
      ],
    }));
    expect(facts.refMovementRelations).toHaveLength(2);
    expect(facts.refMovementRelations?.map((relation) => relation.kind).sort()).toEqual(['branch-move', 'reset']);
    const layout = createGraphLayout(facts, { visibleCommitCount: 3, hasMore: false });
    expect(layout.refMovementPaths).toHaveLength(2);
  });

  it('V6: live feature stays on the message side beside graph-side ghost main', () => {
    const facts = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') },
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('c') },
      ],
      historyEvents: [resetEvent('c', 'a')],
    }));
    const old = node(facts, 'c');
    const names = new Set(graphSideRefEndpoints([old], facts.refMovementRelations ?? []).map((endpoint) => endpoint.badge.fullName));
    expect(graphSideRefEndpoints([old], facts.refMovementRelations ?? [])).toEqual([
      expect.objectContaining({ ghost: true, badge: expect.objectContaining({ name: 'main' }) }),
    ]);
    expect(messageSideRefBadges(old, names).map((badge) => badge.name)).toEqual(['feature']);
    expect(messageSideGhostRefBadges(old, names)).toEqual([]);
  });

  it('V7: Reflog OFF restores the normal message-side current main badge', () => {
    const hidden = buildGraphFacts(snapshot({
      commits: [commit('c', ['b'], 3), commit('b', ['a'], 2), commit('a', [], 1)],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('a'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
      historyEvents: [resetEvent('c', 'a')],
    }), { showReflog: false });
    const current = node(hidden, 'a');
    expect(endpointsFor(hidden)).toEqual([]);
    expect(messageSideRefBadges(current, new Set()).map((badge) => badge.name)).toEqual(['main']);
  });

  it('V8: Amend / Cherry-pick / Revert do not get graph-side endpoint badges', () => {
    const source: GraphNode = {
      id: 'commit:s',
      kind: 'commit',
      oid: oid('s'),
      refIds: [],
      refBadges: [{ fullName: 'refs/heads/main', name: 'main', kind: 'local' }],
    };
    const target: GraphNode = {
      id: 'commit:n',
      kind: 'commit',
      oid: oid('n'),
      refIds: [],
      refBadges: [{ fullName: 'refs/heads/main', name: 'main', kind: 'local' }],
    };
    const relations: HistoryRelation[] = [
      { id: 'amend:one', kind: 'amend', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' },
      { id: 'cherry:one', kind: 'cherry-pick', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' },
      { id: 'revert:one', kind: 'revert', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' },
    ];
    expect(graphSideRefEndpoints([source, target], [])).toEqual([]);
    expect(relations.map((relation) => relation.kind)).toEqual(['amend', 'cherry-pick', 'revert']);
  });
});
