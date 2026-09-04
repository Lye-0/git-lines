import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { routeCherryPickGroups, rebaseGroupBounds, pointForNode } from '../../src/layout/edgeRouter.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { insertOperationAnnotationRows } from '../../src/layout/operationRows.js';
import { buildCherryPickGroups } from '../../src/model/cherryPickGroupRelation.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { CherryPickGroupRelation, GraphNode, HistoryRelation } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);

function commit(id: string, parents: string[], date: number): GitCommit {
  return {
    oid: oid(id),
    parentOids: parents.map(oid),
    subject: id,
    authorName: 'A',
    authorDate: date,
    committerName: 'A',
    committerDate: date,
  };
}

function cherryEvent(target: string, source: string | undefined, from: string, timestamp: number): HistoryEvent {
  return {
    id: `history:cherry-pick:${timestamp}:${oid(target)}`,
    type: 'cherry-pick',
    refName: 'refs/heads/main',
    fromOid: oid(from),
    toOid: oid(target),
    timestamp,
    subject: 'cherry-pick: source',
    ...(source ? { sourceOid: oid(source) } : {}),
  };
}

function exactRelation(source: string, target: string, timestamp: number): HistoryRelation {
  return {
    id: `history:cherry-pick:${timestamp}:${oid(target)}`,
    kind: 'cherry-pick',
    sourceOid: oid(source),
    targetOid: oid(target),
    refName: 'refs/heads/main',
    timestamp,
    evidence: 'reflog',
  };
}

const multipleCommits: GitCommit[] = [
  commit('3', ['2'], 8),
  commit('2', ['1'], 7),
  commit('1', ['m'], 6),
  commit('c', ['b'], 5),
  commit('b', ['a'], 4),
  commit('a', ['i'], 3),
  commit('m', ['i'], 2),
  commit('i', [], 1),
];

const multipleEvents = [
  cherryEvent('3', 'c', '2', 8),
  cherryEvent('2', 'b', '1', 7),
  cherryEvent('1', 'a', 'm', 6),
];

const multipleRelations = [
  exactRelation('a', '1', 6),
  exactRelation('b', '2', 7),
  exactRelation('c', '3', 8),
];

const snapshotBase: RepositorySnapshot = {
  repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
  commits: multipleCommits,
  refs: [
    { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('3') },
    { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('c') },
  ],
  workingTrees: [{
    worktreeId: 'worktree-0',
    path: 'C:/repo',
    headOid: oid('3'),
    branch: 'main',
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
  }],
  operations: [],
  reflogs: [],
  historyEvents: multipleEvents,
  shallowBoundaryOids: [],
  hasMore: false,
  visibleCommitCount: multipleCommits.length,
};

describe('exact cherry-pick grouping', () => {
  it('CP-G1 / CP-G2 / CP-G3 groups three contiguous -x mappings oldest to newest', () => {
    const { groups, remaining } = buildCherryPickGroups(multipleRelations, new Map(multipleCommits.map((item) => [item.oid, item])), {
      events: multipleEvents,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'cherry-pick-group',
      evidence: 'commit-body',
      sourceOids: [oid('a'), oid('b'), oid('c')],
      targetOids: [oid('1'), oid('2'), oid('3')],
      sourceTipOid: oid('c'),
      targetTipOid: oid('3'),
      mappings: [
        { sourceOid: oid('a'), targetOid: oid('1') },
        { sourceOid: oid('b'), targetOid: oid('2') },
        { sourceOid: oid('c'), targetOid: oid('3') },
      ],
    });
    expect(remaining.filter((relation) => relation.kind === 'cherry-pick')).toEqual([]);
  });

  it('CP-G4 does not group a single exact cherry-pick', () => {
    const commits = [commit('n', ['b'], 3), commit('s', ['a'], 3), commit('b', ['a'], 2), commit('a', [], 1)];
    const relations = [exactRelation('s', 'n', 3)];
    const events = [cherryEvent('n', 's', 'b', 3)];
    const { groups, remaining } = buildCherryPickGroups(relations, new Map(commits.map((item) => [item.oid, item])), { events });
    expect(groups).toEqual([]);
    expect(remaining).toEqual(relations);
  });

  it('CP-G5 does not invent mappings without -x evidence', () => {
    const events = [
      cherryEvent('3', undefined, '2', 8),
      cherryEvent('2', undefined, '1', 7),
      cherryEvent('1', undefined, 'm', 6),
    ];
    const { groups, remaining } = buildCherryPickGroups([], new Map(multipleCommits.map((item) => [item.oid, item])), { events });
    expect(groups).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it('CP-G6 does not group a contiguous session when any member lacks source evidence', () => {
    const events = [
      cherryEvent('3', undefined, '2', 8),
      cherryEvent('2', 'b', '1', 7),
      cherryEvent('1', 'a', 'm', 6),
    ];
    const relations = [exactRelation('a', '1', 6), exactRelation('b', '2', 7)];
    const { groups, remaining } = buildCherryPickGroups(relations, new Map(multipleCommits.map((item) => [item.oid, item])), { events });
    expect(groups).toEqual([]);
    expect(remaining).toEqual(relations);
  });

  it('CP-G7 does not group exact cherry-picks separated by another commit', () => {
    const commits = [
      commit('3', ['x'], 6),
      commit('x', ['1'], 5),
      commit('1', ['m'], 4),
      commit('c', ['a'], 4),
      commit('a', ['i'], 3),
      commit('m', ['i'], 2),
      commit('i', [], 1),
    ];
    const relations = [exactRelation('a', '1', 4), exactRelation('c', '3', 6)];
    const events = [cherryEvent('1', 'a', 'm', 4), cherryEvent('3', 'c', 'x', 6)];
    const { groups } = buildCherryPickGroups(relations, new Map(commits.map((item) => [item.oid, item])), { events });
    expect(groups).toEqual([]);
  });

  it('does not group when HEAD reflog inserts a non-cherry-pick between picks', () => {
    const reflogs = [
      { refName: 'HEAD', selector: 'HEAD@{0}', newOid: oid('3'), previousOid: oid('1'), timestamp: 8, subject: 'cherry-pick: three' },
      { refName: 'HEAD', selector: 'HEAD@{1}', newOid: oid('x'), previousOid: oid('1'), timestamp: 7, subject: 'commit: other' },
      { refName: 'HEAD', selector: 'HEAD@{2}', newOid: oid('1'), previousOid: oid('m'), timestamp: 6, subject: 'cherry-pick: one' },
    ];
    const commits = [
      commit('3', ['1'], 8),
      commit('1', ['m'], 6),
      commit('c', ['a'], 5),
      commit('a', ['i'], 3),
      commit('m', ['i'], 2),
      commit('i', [], 1),
    ];
    const relations = [exactRelation('a', '1', 6), exactRelation('c', '3', 8)];
    const events = [cherryEvent('1', 'a', 'm', 6), cherryEvent('3', 'c', '1', 8)];
    const { groups } = buildCherryPickGroups(relations, new Map(commits.map((item) => [item.oid, item])), { events, reflogs });
    expect(groups).toEqual([]);
  });

  it('does not group exact cherry-picks when Amend sits on the target chain', () => {
    const events: HistoryEvent[] = [
      ...multipleEvents,
      {
        id: 'history:amend:7',
        type: 'amend',
        refName: 'refs/heads/main',
        fromOid: oid('x'),
        toOid: oid('2'),
        timestamp: 7,
        subject: 'commit (amend): two',
      },
    ];
    const { groups, remaining } = buildCherryPickGroups(multipleRelations, new Map(multipleCommits.map((item) => [item.oid, item])), { events });
    expect(groups).toEqual([]);
    expect(remaining).toEqual(multipleRelations);
  });
});

describe('graph facts cherry-pick grouping', () => {
  it('CP-G8 / CP-G9 / CP-G10 / CP-G11 / CP-G12 keeps DAG topology and one grouped overlay', () => {
    const facts = buildGraphFacts(snapshotBase, { showReflog: true });
    const parentEdges = facts.edges.filter((edge) => edge.type === 'parent');
    expect(facts.historyRelations?.filter((relation) => relation.kind === 'cherry-pick')).toEqual([]);
    expect(facts.cherryPickGroupRelations).toHaveLength(1);
    expect(facts.nodes.find((node) => node.oid === oid('a'))).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(facts.nodes.find((node) => node.oid === oid('b'))).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(facts.nodes.find((node) => node.oid === oid('c'))).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(parentEdges).toHaveLength(7);
    expect(parentEdges.some((edge) => edge.fromNodeId === `commit:${oid('1')}` && edge.toNodeId === `commit:${oid('a')}`)).toBe(false);

    const layout = createGraphLayout(facts, { visibleCommitCount: facts.commits.length, hasMore: false });
    expect(layout.historyRelationPaths).toEqual([]);
    expect(layout.cherryPickGroupPaths).toHaveLength(1);
    expect(layout.cherryPickGroupOutlines).toHaveLength(2);
    expect(layout.operationAnnotationRows).toHaveLength(1);
    expect(layout.operationAnnotationRows?.[0]?.relationId).toBe(facts.cherryPickGroupRelations?.[0]?.id);
    expect(layout.cherryPickGroupPaths?.[0]?.kind).toBe('cherry-pick-group');
  });

  it('hides grouped cherry-pick overlays when reflog is off and leaves live commits', () => {
    const hidden = buildGraphFacts(snapshotBase, { showReflog: false });
    expect(hidden.cherryPickGroupRelations).toEqual([]);
    expect(hidden.historyRelations).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === oid('a'))?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === oid('3'))?.kind).toBe('commit');
    const layout = createGraphLayout(hidden, { visibleCommitCount: hidden.commits.length, hasMore: false });
    expect(layout.cherryPickGroupPaths).toEqual([]);
    expect(layout.operationAnnotationRows).toEqual([]);
  });

  it('keeps 117-style singles as HistoryRelations', () => {
    const facts = buildGraphFacts({
      ...snapshotBase,
      commits: [commit('n', ['m'], 4), commit('s', ['i'], 3), commit('m', ['i'], 2), commit('i', [], 1)],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('n') },
        { fullName: 'refs/heads/source', shortName: 'source', type: 'local', oid: oid('s') },
      ],
      workingTrees: [{ ...snapshotBase.workingTrees[0], headOid: oid('n') }],
      historyEvents: [cherryEvent('n', 's', 'm', 4)],
      visibleCommitCount: 4,
    }, { showReflog: true });
    expect(facts.cherryPickGroupRelations).toEqual([]);
    expect(facts.historyRelations).toEqual([expect.objectContaining({ kind: 'cherry-pick', sourceOid: oid('s'), targetOid: oid('n') })]);
  });
});

describe('cherry-pick group overlay geometry', () => {
  it('CP-G11 / CP-G12 / CP-G13 outlines source and target members and points SOURCE → TARGET', () => {
    const node = (id: string, row: number, lane: number): GraphNode => ({
      id: `commit:${id}`,
      kind: 'commit',
      oid: oid(id),
      refIds: [],
      row,
      lane,
      subject: id,
    });
    const nodes = [
      node('3', 0, 0),
      node('2', 1, 0),
      node('1', 2, 0),
      node('m', 3, 0),
      node('c', 5, 1),
      node('b', 6, 1),
      node('a', 7, 1),
      node('i', 8, 0),
    ];
    const relation: CherryPickGroupRelation = {
      id: 'history:cherry-pick-group:1',
      kind: 'cherry-pick-group',
      mappings: [
        { sourceOid: oid('a'), targetOid: oid('1') },
        { sourceOid: oid('b'), targetOid: oid('2') },
        { sourceOid: oid('c'), targetOid: oid('3') },
      ],
      sourceOids: [oid('a'), oid('b'), oid('c')],
      targetOids: [oid('1'), oid('2'), oid('3')],
      sourceTipOid: oid('c'),
      targetTipOid: oid('3'),
      timestamp: 1,
      evidence: 'commit-body',
    };
    const overlay = routeCherryPickGroups(nodes, [relation]);
    expect(overlay.outlines).toHaveLength(2);
    expect(overlay.paths).toHaveLength(1);
    const sourceBounds = rebaseGroupBounds(nodes, [oid('a'), oid('b'), oid('c')])!;
    const targetBounds = rebaseGroupBounds(nodes, [oid('1'), oid('2'), oid('3')])!;
    const initial = pointForNode(nodes.find((item) => item.oid === oid('i'))!);
    const onto = pointForNode(nodes.find((item) => item.oid === oid('m'))!);
    expect(initial.x < sourceBounds.minX || initial.x > sourceBounds.maxX || initial.y < sourceBounds.minY || initial.y > sourceBounds.maxY).toBe(true);
    expect(onto.x < targetBounds.minX || onto.x > targetBounds.maxX || onto.y < targetBounds.minY || onto.y > targetBounds.maxY).toBe(true);
    const numbers = (overlay.paths[0]!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const start = { x: numbers[0], y: numbers[1] };
    const end = { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
    const sourceCenter = { x: (sourceBounds.minX + sourceBounds.maxX) / 2, y: (sourceBounds.minY + sourceBounds.maxY) / 2 };
    const targetCenter = { x: (targetBounds.minX + targetBounds.maxX) / 2, y: (targetBounds.minY + targetBounds.maxY) / 2 };
    expect(Math.hypot(start.x - sourceCenter.x, start.y - sourceCenter.y)).toBeLessThan(Math.hypot(start.x - targetCenter.x, start.y - targetCenter.y));
    expect(Math.hypot(end.x - targetCenter.x, end.y - targetCenter.y)).toBeLessThan(Math.hypot(end.x - sourceCenter.x, end.y - sourceCenter.y));
    const arrowNumbers = (overlay.paths[0]!.arrowD.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const tip = { x: arrowNumbers[0], y: arrowNumbers[1] };
    expect(Math.hypot(tip.x - targetCenter.x, tip.y - targetCenter.y)).toBeLessThan(Math.hypot(tip.x - sourceCenter.x, tip.y - sourceCenter.y));
    expect(insertOperationAnnotationRows(nodes, [relation]).rows).toHaveLength(1);
  });
});
