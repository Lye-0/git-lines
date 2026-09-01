import { describe, expect, it } from 'vitest';
import { assignBranchSegmentLanes, computeLaneLayout } from '../../src/layout/laneLayout.js';
import { computeRowLayout, assertRowInvariants } from '../../src/layout/rowLayout.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { filterRenderableEdgePaths } from '../../src/layout/edgeVisibility.js';
import { pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';
import { HISTORICAL_ROUTE_COLOR, isSafeLiveBranchColor } from '../../src/utils/color.js';
import type { EdgePath } from '../../src/layout/layoutTypes.js';
import type { GraphFactModel, GraphNode } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);
function commitNode(letter: string, date: number): GraphNode { return { id: `commit:${oid(letter)}`, kind: 'commit', oid: oid(letter), refIds: [], timestamp: date, subject: letter }; }

function refFor(shortName: string, type: 'local' | 'remote', commitOid: string) {
  return {
    fullName: type === 'local' ? `refs/heads/${shortName}` : `refs/remotes/origin/${shortName}`,
    shortName: type === 'local' ? shortName : `origin/${shortName}`,
    type,
    oid: commitOid,
  } as const;
}

function linearRefFacts(localOid: string, remoteOid: string): GraphFactModel {
  const a = { ...commitNode('a', 1), row: 2 };
  const b = { ...commitNode('b', 2), row: 1 };
  const c = { ...commitNode('c', 3), row: 0 };
  return {
    nodes: [c, b, a],
    edges: [
      { id: 'parent:c:b', type: 'parent', fromNodeId: c.id, toNodeId: b.id },
      { id: 'parent:b:a', type: 'parent', fromNodeId: b.id, toNodeId: a.id },
    ],
    refs: [refFor('feature', 'local', localOid), refFor('feature', 'remote', remoteOid)],
    commits: [
      { oid: c.oid!, parentOids: [b.oid!], subject: 'c', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: b.oid!, parentOids: [a.oid!], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: a.oid!, parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ],
    workingTrees: [],
    operations: [],
    events: [],
    shallowBoundaryOids: [],
  };
}

function testCommit(letter: string, parentLetters: string[], date: number, subject = letter) {
  return {
    oid: oid(letter),
    parentOids: parentLetters.map(oid),
    subject,
    authorName: 'A',
    authorDate: date,
    committerName: 'A',
    committerDate: date,
  };
}

function dagFacts(commits: GraphFactModel['commits'], refs: GraphFactModel['refs']): GraphFactModel {
  const nodeOids = new Set(commits.map((commit) => commit.oid));
  const nodes: GraphNode[] = commits.map((commit, row) => ({
    id: `commit:${commit.oid}`,
    kind: 'commit',
    oid: commit.oid,
    refIds: refs.filter((ref) => ref.oid === commit.oid).map((ref) => ref.shortName),
    row,
    timestamp: commit.committerDate,
    subject: commit.subject,
  }));
  const edges = commits.flatMap((commit) => commit.parentOids
    .filter((parentOid) => nodeOids.has(parentOid))
    .map((parentOid) => ({
      id: `parent:${commit.oid}:${parentOid}`,
      type: 'parent' as const,
      fromNodeId: `commit:${commit.oid}`,
      toNodeId: `commit:${parentOid}`,
    })));
  return { nodes, edges, refs, commits, workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
}

function rebaseFacts(multiCommit = false): GraphFactModel {
  const base = { ...commitNode('a', 1), refIds: ['main'] };
  const first = { ...commitNode('b', 2), refIds: ['feature'] };
  const tip = multiCommit ? { ...commitNode('c', 3), refIds: ['feature'] } : first;
  const eventId = multiCommit ? 'event:rebase:multi' : 'event:rebase:single';
  const event: GraphNode = {
    id: eventId,
    kind: 'history-event',
    refIds: ['feature'],
    label: 'Rebase · feature',
    anchorCommitId: tip.id,
    eventBoundaryCommitId: base.id,
    eventStartCommitId: first.id,
    targetRef: 'refs/heads/feature',
    event: {
      id: eventId,
      type: 'rebase',
      refName: 'refs/heads/feature',
      fromOid: oid('o'),
      toOid: tip.oid!,
      boundaryOid: base.oid,
      eventStartOid: first.oid,
      timestamp: 4,
    },
  };
  const commits = multiCommit
    ? [
      { oid: tip.oid!, parentOids: [first.oid!], subject: 'new tip', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: first.oid!, parentOids: [base.oid!], subject: 'new first', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: base.oid!, parentOids: [], subject: 'new base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ]
    : [
      { oid: tip.oid!, parentOids: [base.oid!], subject: 'new tip', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: base.oid!, parentOids: [], subject: 'new base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
  const parentEdges = multiCommit
    ? [
      { id: 'parent:c:b', type: 'parent' as const, fromNodeId: tip.id, toNodeId: first.id },
      { id: 'parent:b:a', type: 'parent' as const, fromNodeId: first.id, toNodeId: base.id },
    ]
    : [{ id: 'parent:b:a', type: 'parent' as const, fromNodeId: tip.id, toNodeId: base.id }];
  return {
    nodes: multiCommit ? [tip, first, base, event] : [tip, base, event],
    edges: [...parentEdges, { id: `${eventId}:annotation`, type: 'history-event', fromNodeId: first.id, toNodeId: event.id, annotation: 'ref-event' }],
    refs: [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: base.oid },
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: tip.oid! },
    ],
    commits,
    workingTrees: [],
    operations: [],
    events: [event.event!],
    primaryBranch: 'main',
    shallowBoundaryOids: [],
  };
}

describe('graph layout', () => {
  it('reuses a lane for non-overlapping branch segments', () => {
    const lanes = assignBranchSegmentLanes([
      { id: 'feature-a:segment-0', trackId: 'feature-a', startRow: 1000, endRow: 700 },
      { id: 'feature-b:segment-0', trackId: 'feature-b', startRow: 600, endRow: 300 },
    ]);
    expect(lanes.get('feature-a:segment-0')).toBe(1);
    expect(lanes.get('feature-b:segment-0')).toBe(1);
  });

  it('keeps overlapping branch segments on different lanes', () => {
    const lanes = assignBranchSegmentLanes([
      { id: 'feature-a:segment-0', trackId: 'feature-a', startRow: 1000, endRow: 500 },
      { id: 'feature-b:segment-0', trackId: 'feature-b', startRow: 800, endRow: 300 },
    ]);
    expect(lanes.get('feature-a:segment-0')).not.toBe(lanes.get('feature-b:segment-0'));
  });

  it('chooses the leftmost available lane for a new segment', () => {
    const lanes = assignBranchSegmentLanes([
      { id: 'short:segment-0', trackId: 'short', startRow: 0, endRow: 5 },
      { id: 'long:segment-0', trackId: 'long', startRow: 0, endRow: 20 },
      { id: 'new:segment-0', trackId: 'new', startRow: 6, endRow: 10 },
    ]);
    expect(lanes.get('short:segment-0')).toBe(1);
    expect(lanes.get('long:segment-0')).toBe(2);
    expect(lanes.get('new:segment-0')).toBe(1);
  });

  it('preserves an existing segment lane without reserving it for a new range', () => {
    const lanes = assignBranchSegmentLanes([
      { id: 'existing:segment-0', trackId: 'existing', startRow: 0, endRow: 5, nodeIds: ['old-node'] },
      { id: 'other:segment-0', trackId: 'other', startRow: 0, endRow: 5 },
      { id: 'new:segment-0', trackId: 'existing', startRow: 6, endRow: 10, nodeIds: ['new-node'] },
    ], {
      previousLanes: new Map([['existing', 2]]),
      previousNodeLanes: new Map([['old-node', 2]]),
    });
    expect(lanes.get('existing:segment-0')).toBe(2);
    expect(lanes.get('other:segment-0')).toBe(1);
    expect(lanes.get('new:segment-0')).toBe(1);
  });

  it('keeps every node in one connected branch segment on one lane', () => {
    const first = { ...commitNode('a', 3), row: 0 };
    const second = { ...commitNode('b', 2), row: 2 };
    const refs = [{ fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: first.oid }];
    const facts: GraphFactModel = {
      nodes: [first, second],
      edges: [{ id: 'parent:a:b', type: 'parent' as const, fromNodeId: first.id, toNodeId: second.id }],
      refs,
      commits: [
        { oid: first.oid!, parentOids: [second.oid!], subject: 'a', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: second.oid!, parentOids: [], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      ],
      workingTrees: [],
      operations: [],
      events: [],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    };
    const result = computeLaneLayout(facts);
    expect(result.nodes.map((node) => node.lane)).toEqual([1, 1]);
    expect(result.tracks[0]?.segments).toEqual([{ startRow: 0, endRow: 2, lane: 1 }]);
  });

  it('reuses the same lane for disjoint branch ranges while reserving main at zero', () => {
    const main = { ...commitNode('m', 5), row: 0 };
    const firstA = { ...commitNode('a', 4), row: 1 };
    const lastA = { ...commitNode('b', 3), row: 2 };
    const firstB = { ...commitNode('c', 2), row: 4 };
    const lastB = { ...commitNode('d', 1), row: 5 };
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: main.oid },
      { fullName: 'refs/heads/feature-a', shortName: 'feature-a', type: 'local' as const, oid: firstA.oid },
      { fullName: 'refs/heads/feature-b', shortName: 'feature-b', type: 'local' as const, oid: firstB.oid },
    ];
    const facts: GraphFactModel = {
      nodes: [main, firstA, lastA, firstB, lastB],
      edges: [
        { id: 'parent:a:b', type: 'parent' as const, fromNodeId: firstA.id, toNodeId: lastA.id },
        { id: 'parent:c:d', type: 'parent' as const, fromNodeId: firstB.id, toNodeId: lastB.id },
      ],
      refs,
      commits: [
        { oid: main.oid!, parentOids: [], subject: 'main', authorName: 'A', authorDate: 5, committerName: 'A', committerDate: 5 },
        { oid: firstA.oid!, parentOids: [lastA.oid!], subject: 'a', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: lastA.oid!, parentOids: [], subject: 'b', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: firstB.oid!, parentOids: [lastB.oid!], subject: 'c', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: lastB.oid!, parentOids: [], subject: 'd', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
      ],
      workingTrees: [],
      operations: [],
      events: [],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    };
    const result = computeLaneLayout(facts);
    expect(result.nodes.find((node) => node.id === main.id)?.lane).toBe(0);
    expect(result.nodes.filter((node) => [firstA.id, lastA.id, firstB.id, lastB.id].includes(node.id)).map((node) => node.lane)).toEqual([1, 1, 1, 1]);
  });

  it('reconstructs historical sequential merge branches without current refs', () => {
    const commits = [
      testCommit('m', ['p', 's'], 6, 'merge second'),
      testCommit('s', ['p'], 5, 'second segment'),
      testCommit('p', ['b', 'f'], 4, 'merge first'),
      testCommit('f', ['b'], 3, 'first segment'),
      testCommit('b', ['i'], 2, 'main base'),
      testCommit('i', [], 1, 'initial'),
    ];
    const result = computeLaneLayout(dagFacts(commits, [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('m') }]));
    const laneFor = (letter: string) => result.nodes.find((node) => node.oid === oid(letter))?.lane;
    expect(['m', 'p', 'b', 'i'].map(laneFor)).toEqual([0, 0, 0, 0]);
    expect(laneFor('s')).toBe(laneFor('f'));
    expect(laneFor('s')).toBeGreaterThan(0);
    const mergedSideRoutes = result.tracks.filter((track) => track.label === 'Merged side route');
    expect(mergedSideRoutes).toHaveLength(2);
    expect(mergedSideRoutes.every((track) => track.family !== 'historical')).toBe(true);
    expect(mergedSideRoutes.every((track) => isSafeLiveBranchColor(track.color))).toBe(true);
    expect(mergedSideRoutes.every((track) => track.color !== HISTORICAL_ROUTE_COLOR)).toBe(true);
  });

  it('keeps an octopus merge first-parent spine on the primary lane', () => {
    const commits = [
      testCommit('m', ['x', 'a', 'b', 'c'], 7, 'octopus'),
      testCommit('x', ['z'], 6, 'main side'),
      testCommit('a', ['z'], 5, 'feature a'),
      testCommit('b', ['z'], 4, 'feature b'),
      testCommit('c', ['z'], 3, 'feature c'),
      testCommit('z', ['i'], 2, 'shared base'),
      testCommit('i', [], 1, 'initial'),
    ];
    const result = computeLaneLayout(dagFacts(commits, [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('m') }]));
    const laneFor = (letter: string) => result.nodes.find((node) => node.oid === oid(letter))?.lane;
    expect(['m', 'x', 'z', 'i'].map(laneFor)).toEqual([0, 0, 0, 0]);
    expect(new Set(['a', 'b', 'c'].map(laneFor)).size).toBe(3);
    expect(['a', 'b', 'c'].every((letter) => (laneFor(letter) ?? 0) > 0)).toBe(true);
  });

  it('keeps repeated merge first-parent history continuous while side branches remain separate', () => {
    const commits = [
      testCommit('m', ['n', 'c'], 9, 'merge C'),
      testCommit('c', ['q'], 8, 'feature C'),
      testCommit('n', ['a', 'q'], 7, 'merge B'),
      testCommit('q', ['r'], 6, 'feature B two'),
      testCommit('r', ['a'], 5, 'feature B one'),
      testCommit('a', ['z', 'w'], 4, 'merge A'),
      testCommit('w', ['z'], 3, 'feature A'),
      testCommit('z', ['i'], 2, 'main base'),
      testCommit('i', [], 1, 'initial'),
    ];
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('m') },
      { fullName: 'refs/heads/feature-a', shortName: 'feature-a', type: 'local' as const, oid: oid('w') },
      { fullName: 'refs/heads/feature-b', shortName: 'feature-b', type: 'local' as const, oid: oid('q') },
      { fullName: 'refs/heads/feature-c', shortName: 'feature-c', type: 'local' as const, oid: oid('c') },
    ];
    const result = computeLaneLayout(dagFacts(commits, refs));
    const laneFor = (letter: string) => result.nodes.find((node) => node.oid === oid(letter))?.lane;
    expect(['m', 'n', 'a', 'z', 'i'].map(laneFor)).toEqual([0, 0, 0, 0, 0]);
    expect(laneFor('q')).toBe(laneFor('r'));
    expect(laneFor('q')).not.toBe(laneFor('c'));
    expect(laneFor('w')).toBeGreaterThan(0);
  });

  it('does not let ORIG_HEAD change the primary lane of a merge', () => {
    const commits = [
      testCommit('m', ['n', 'f'], 5, 'merge'),
      testCommit('n', ['b'], 4, 'main side'),
      testCommit('f', ['b'], 3, 'feature'),
      testCommit('b', ['i'], 2, 'base'),
      testCommit('i', [], 1, 'initial'),
    ];
    const refs: GraphFactModel['refs'] = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('m') },
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('f') },
      { fullName: 'ORIG_HEAD', shortName: 'ORIG_HEAD', type: 'symbolic', oid: oid('n') },
    ];
    const result = computeLaneLayout(dagFacts(commits, refs));
    const laneFor = (letter: string) => result.nodes.find((node) => node.oid === oid(letter))?.lane;
    expect(['m', 'n', 'b', 'i'].map(laneFor)).toEqual([0, 0, 0, 0]);
    expect(laneFor('f')).toBeGreaterThan(0);
  });

  it('defaults a main family to lane zero when no primary branch is supplied', () => {
    const main = { ...commitNode('m', 2), row: 0 };
    const feature = { ...commitNode('f', 1), row: 1 };
    const refs = [
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: feature.oid },
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: main.oid },
    ];
    const result = computeLaneLayout({
      nodes: [main, feature],
      edges: [],
      refs,
      commits: [
        { oid: main.oid!, parentOids: [], subject: 'main', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: feature.oid!, parentOids: [], subject: 'feature', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
      ],
      workingTrees: [],
      operations: [],
      events: [],
      shallowBoundaryOids: [],
    });
    expect(result.nodes.find((node) => node.id === main.id)?.lane).toBe(0);
    expect(result.nodes.find((node) => node.id === feature.id)?.lane).toBe(1);
  });

  it('keeps every node on a unique row and parents below children despite timestamp inversion', () => {
    const child = commitNode('a', 100);
    const parent = commitNode('b', 200);
    const edge = { id: 'parent:a:b', type: 'parent' as const, fromNodeId: child.id, toNodeId: parent.id };
    const result = computeRowLayout([child, parent], [edge]);
    assertRowInvariants(result.nodes, [edge]);
    expect(result.rows.get(child.id)).toBeLessThan(result.rows.get(parent.id)!);
  });

  it('assigns primary branch to lane zero and keeps a stopped main separate from feature commits', () => {
    const a = commitNode('a', 1);
    const b = { ...commitNode('b', 2), refIds: ['feature'] };
    const main = { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') };
    const feature = { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: oid('b') };
    const facts: GraphFactModel = { nodes: [a, b], edges: [], refs: [main, feature], commits: [{ oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 }, { oid: oid('b'), parentOids: [oid('a')], subject: 'b', authorName: 'B', authorDate: 2, committerName: 'B', committerDate: 2 }], workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const result = computeLaneLayout(facts);
    expect(result.lanes.get('family:main')).toBe(0);
    expect(result.nodes.find((node) => node.oid === oid('a'))?.lane).toBe(0);
    expect(result.nodes.find((node) => node.oid === oid('b'))?.lane).toBeGreaterThan(0);
  });

  it('merges local and remote refs on the same commit into one family track', () => {
    const node = commitNode('a', 1);
    const refs = [
      { fullName: 'refs/heads/feature/x', shortName: 'feature/x', type: 'local' as const, oid: oid('a') },
      { fullName: 'refs/remotes/origin/feature/x', shortName: 'origin/feature/x', type: 'remote' as const, oid: oid('a') },
    ];
    const facts: GraphFactModel = { nodes: [node], edges: [], refs, commits: [{ oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 }], workingTrees: [], operations: [], events: [], shallowBoundaryOids: [] };
    const result = computeLaneLayout(facts);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].refNames).toEqual(refs.map((ref) => ref.fullName));
  });

  it('keeps a local-ahead and remote mid-chain ref on one lane', () => {
    const facts = linearRefFacts(oid('c'), oid('b'));
    const result = computeLaneLayout(facts);
    expect(result.tracks).toHaveLength(1);
    expect(new Set(result.nodes.map((node) => node.lane))).toEqual(new Set([1]));
    expect(result.tracks[0]?.refNames).toEqual(facts.refs.map((ref) => ref.fullName));
  });

  it('keeps a remote-ahead and local mid-chain ref on one lane', () => {
    const facts = linearRefFacts(oid('b'), oid('c'));
    const result = computeLaneLayout(facts);
    expect(result.tracks).toHaveLength(1);
    // The remote tip is beyond the local tip; all three commits must still be
    // claimed by the unified family track rather than falling back to lane 0.
    expect(new Set(result.nodes.map((node) => node.lane))).toEqual(new Set([1]));
    expect(result.nodes.every((node) => node.trackId === 'family:feature')).toBe(true);
  });

  it('keeps genuinely diverged local and remote tips on different lanes', () => {
    const base = { ...commitNode('a', 1), row: 2 };
    const local = { ...commitNode('b', 2), row: 0 };
    const remote = { ...commitNode('c', 2), row: 1 };
    const facts: GraphFactModel = {
      nodes: [local, remote, base],
      edges: [
        { id: 'parent:b:a', type: 'parent', fromNodeId: local.id, toNodeId: base.id },
        { id: 'parent:c:a', type: 'parent', fromNodeId: remote.id, toNodeId: base.id },
      ],
      refs: [refFor('feature', 'local', local.oid!), refFor('feature', 'remote', remote.oid!)],
      commits: [
        { oid: local.oid!, parentOids: [base.oid!], subject: 'local', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: remote.oid!, parentOids: [base.oid!], subject: 'remote', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: base.oid!, parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
      ],
      workingTrees: [],
      operations: [],
      events: [],
      shallowBoundaryOids: [],
    };
    const result = computeLaneLayout(facts);
    const localNode = result.nodes.find((node) => node.oid === local.oid)!;
    const remoteNode = result.nodes.find((node) => node.oid === remote.oid)!;
    expect(result.tracks).toHaveLength(2);
    expect(localNode.trackId).not.toBe(remoteNode.trackId);
    expect(localNode.lane).not.toBe(remoteNode.lane);
  });

  it('keeps local, Alice, and Bob refs on one lane when their tips are one chain', () => {
    const commits = [
      testCommit('c', ['b'], 4, 'C'),
      testCommit('b', ['a'], 3, 'B'),
      testCommit('a', ['i'], 2, 'A'),
      testCommit('i', [], 1, 'Initial'),
    ];
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('i') },
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: oid('a') },
      { fullName: 'refs/remotes/alice/feature', shortName: 'alice/feature', type: 'remote' as const, oid: oid('b') },
      { fullName: 'refs/remotes/bob/feature', shortName: 'bob/feature', type: 'remote' as const, oid: oid('c') },
    ];
    const facts = { ...dagFacts(commits, refs), primaryBranch: 'feature' };
    const result = computeLaneLayout(facts);
    const featureTracks = result.tracks.filter((track) => track.family === 'feature');
    const featureOids = new Set([oid('a'), oid('b'), oid('c')]);
    const featureNodes = result.nodes.filter((node) => node.oid && featureOids.has(node.oid));

    expect(featureTracks).toHaveLength(1);
    expect(featureTracks[0]?.refNames).toEqual(expect.arrayContaining([
      'refs/heads/feature',
      'refs/remotes/alice/feature',
      'refs/remotes/bob/feature',
    ]));
    expect(featureTracks[0]?.refNames).toHaveLength(3);
    expect(new Set(featureNodes.map((node) => node.lane)).size).toBe(1);
  });

  it('uses separate lanes but the same hue for diverged routes in one family', () => {
    const commits = [
      testCommit('l', ['m'], 5, 'Local L2'),
      testCommit('m', ['i'], 4, 'Local L1'),
      testCommit('r', ['s'], 3, 'Alice R2'),
      testCommit('s', ['i'], 2, 'Alice R1'),
      testCommit('i', [], 1, 'Initial'),
    ];
    const refs = [
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: oid('l') },
      { fullName: 'refs/remotes/alice/feature', shortName: 'alice/feature', type: 'remote' as const, oid: oid('r') },
    ];
    const result = computeLaneLayout({ ...dagFacts(commits, refs), primaryBranch: 'feature' });
    const featureTracks = result.tracks.filter((track) => track.family === 'feature');
    const hueOf = (color: string) => color.match(/^hsl\((\d+)/)?.[1];

    expect(featureTracks).toHaveLength(2);
    expect(new Set(featureTracks.map((track) => track.lane)).size).toBe(2);
    expect(new Set(featureTracks.map((track) => hueOf(track.color)).filter(Boolean)).size).toBe(1);
    expect(featureTracks[0]?.color).not.toBe(featureTracks[1]?.color);
  });

  it('keeps the Working Tree lane tied to the checked-out local HEAD', () => {
    const facts = linearRefFacts(oid('a'), oid('c'));
    const working: GraphNode = {
      id: 'working:feature',
      kind: 'working-tree',
      oid: oid('a'),
      refIds: [],
      row: 3,
      workingTree: {
        worktreeId: 'feature',
        path: 'C:/repo',
        headOid: oid('a'),
        branch: 'feature',
        detached: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        clean: true,
      },
    };
    facts.nodes = [...facts.nodes, working];
    facts.edges = [...facts.edges, { id: 'working:feature:head', type: 'working-tree', fromNodeId: working.id, toNodeId: `commit:${oid('a')}` }];
    facts.workingTrees = [working.workingTree!];

    const result = computeLaneLayout(facts);
    const laidOutWorking = result.nodes.find((node) => node.id === working.id)!;
    const head = result.nodes.find((node) => node.oid === oid('a'))!;

    expect(laidOutWorking.trackId).toBe(head.trackId);
    expect(laidOutWorking.lane).toBe(head.lane);
    expect(facts.edges.find((edge) => edge.type === 'working-tree')?.toNodeId).toBe(head.id);
  });

  it.each([
    ['reset', 'Reset · main'],
    ['amend', 'Amend · main'],
  ] as const)('places %s reflog commits on a gray historical route', (eventType, eventLabel) => {
    const current = testCommit('n', ['b'], 4, 'Current commit');
    const previous = testCommit('o', ['b'], 3, 'Previous commit');
    const base = testCommit('b', [], 1, 'Initial');
    const currentNode = { ...commitNode('n', 4), row: 1 };
    const previousNode: GraphNode = { ...commitNode('o', 3), kind: 'reflog-commit', row: 2 };
    const baseNode = { ...commitNode('b', 1), row: 3 };
    const event: GraphNode = {
      id: `event:${eventType}`,
      kind: 'history-event',
      row: 0,
      refIds: ['main'],
      timestamp: 5,
      label: eventLabel,
      anchorCommitId: currentNode.id,
      targetRef: 'refs/heads/main',
      event: { id: `event:${eventType}`, type: eventType, refName: 'refs/heads/main', fromOid: previous.oid, toOid: current.oid, timestamp: 5 },
    };
    const result = computeLaneLayout({
      nodes: [event, currentNode, previousNode, baseNode],
      edges: [
        { id: 'parent:n:b', type: 'parent', fromNodeId: currentNode.id, toNodeId: baseNode.id },
        { id: 'parent:o:b', type: 'parent', fromNodeId: previousNode.id, toNodeId: baseNode.id },
        { id: `${event.id}:annotation`, type: 'history-event', fromNodeId: currentNode.id, toNodeId: event.id, annotation: 'ref-event' },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: current.oid }],
      commits: [current, previous, base],
      workingTrees: [],
      operations: [],
      events: [event.event!],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    });
    const historicalTrack = result.tracks.find((track) => track.family === 'historical');
    const laidOutPrevious = result.nodes.find((node) => node.id === previousNode.id)!;
    const laidOutCurrent = result.nodes.find((node) => node.id === currentNode.id)!;

    expect(historicalTrack).toBeDefined();
    expect(laidOutPrevious.trackId).toBe(historicalTrack?.id);
    expect(laidOutPrevious.lane).toBeGreaterThan(laidOutCurrent.lane!);
    expect(historicalTrack?.color).toMatch(/^hsl\(220 8% 62%\)$/);
  });

  it('stops an amend historical route before its live shared ancestry', () => {
    const current = testCommit('n', ['l'], 6, 'Local developer L2');
    const remoteTip = testCommit('s', ['r'], 5, 'Other developer R2');
    const remoteBase = testCommit('r', ['b'], 4, 'Other developer R1');
    const previous = testCommit('o', ['l'], 5, 'Local developer L2');
    const localBase = testCommit('l', ['b'], 3, 'Local developer L1');
    const base = testCommit('b', ['i'], 2, 'A shared feature base');
    const initial = testCommit('i', [], 1, 'Initial commit');
    const nodeFor = (commit: GraphFactModel['commits'][number], row: number, kind: GraphNode['kind'] = 'commit'): GraphNode => ({
      ...commitNode(commit.oid[0]!, commit.committerDate),
      id: `commit:${commit.oid}`,
      oid: commit.oid,
      kind,
      row,
      subject: commit.subject,
      previousRoute: kind === 'reflog-commit',
    });
    const currentNode = nodeFor(current, 0);
    const remoteTipNode = nodeFor(remoteTip, 1);
    const remoteBaseNode = nodeFor(remoteBase, 2);
    const previousNode = nodeFor(previous, 3, 'reflog-commit');
    const localBaseNode = nodeFor(localBase, 4);
    const baseNode = nodeFor(base, 5);
    const initialNode = nodeFor(initial, 6);
    const edge = (from: GraphNode, to: GraphNode): GraphFactModel['edges'][number] => ({
      id: `parent:${from.oid}:${to.oid}`,
      type: 'parent',
      fromNodeId: from.id,
      toNodeId: to.id,
    });
    const amend: GraphFactModel['events'][number] = {
      id: 'event:amend:shared-ancestor',
      type: 'amend',
      refName: 'refs/heads/feature',
      fromOid: previous.oid,
      toOid: current.oid,
      timestamp: 7,
      subject: 'commit (amend): Local developer L2',
    };
    const result = computeLaneLayout({
      nodes: [currentNode, remoteTipNode, remoteBaseNode, previousNode, localBaseNode, baseNode, initialNode],
      edges: [
        edge(currentNode, localBaseNode),
        edge(remoteTipNode, remoteBaseNode),
        edge(remoteBaseNode, baseNode),
        edge(previousNode, localBaseNode),
        edge(localBaseNode, baseNode),
        edge(baseNode, initialNode),
      ],
      refs: [
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: current.oid },
        { fullName: 'refs/remotes/alice/feature', shortName: 'alice/feature', type: 'remote', oid: remoteTip.oid },
        { fullName: 'refs/remotes/bob/feature', shortName: 'bob/feature', type: 'remote', oid: base.oid },
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: initial.oid },
      ],
      commits: [current, remoteTip, remoteBase, previous, localBase, base, initial],
      workingTrees: [],
      operations: [],
      events: [amend],
      primaryBranch: 'feature',
      shallowBoundaryOids: [],
    });
    const historicalTrack = result.tracks.find((track) => track.family === 'historical');
    const liveTrack = result.tracks.find((track) => track.id === result.nodes.find((node) => node.oid === localBase.oid)?.trackId);
    const laidOutPrevious = result.nodes.find((node) => node.oid === previous.oid)!;
    const laidOutLocalBase = result.nodes.find((node) => node.oid === localBase.oid)!;
    const laidOutBase = result.nodes.find((node) => node.oid === base.oid)!;

    expect(historicalTrack).toBeDefined();
    expect(laidOutPrevious.trackId).toBe(historicalTrack?.id);
    expect(laidOutLocalBase.trackId).not.toBe(historicalTrack?.id);
    expect(laidOutBase.trackId).not.toBe(historicalTrack?.id);
    expect(liveTrack?.family).toBe('feature');
    expect(result.nodes.find((node) => node.oid === localBase.oid)?.trackId).toBe(result.nodes.find((node) => node.oid === base.oid)?.trackId);
  });

  it('does not move a branch lane when a remote badge appears mid-chain', () => {
    const facts = linearRefFacts(oid('c'), oid('b'));
    const result = computeLaneLayout(facts);
    const lanesByOid = new Map(result.nodes.map((node) => [node.oid, node.lane]));
    expect(lanesByOid.get(oid('c'))).toBe(lanesByOid.get(oid('b')));
    expect(lanesByOid.get(oid('b'))).toBe(lanesByOid.get(oid('a')));
    expect(result.tracks[0]?.refNames).toContain('refs/remotes/origin/feature');
  });

  it('keeps existing row and lane assignments when older page nodes are appended', () => {
    const a = commitNode('a', 3);
    const b = { ...commitNode('b', 2), refIds: ['main'] };
    const c = commitNode('c', 1);
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') }];
    const commits = [
      { oid: oid('a'), parentOids: [oid('b')], subject: 'a', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('b'), parentOids: [oid('c')], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('c'), parentOids: [], subject: 'c', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const facts = { nodes: [a, b], edges: [{ id: 'ab', type: 'parent' as const, fromNodeId: a.id, toNodeId: b.id }], refs, commits: commits.slice(0, 2), workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const first = createGraphLayout(facts, { visibleCommitCount: 2, hasMore: true });
    const expanded = createGraphLayout({ ...facts, nodes: [...facts.nodes, c], commits }, { visibleCommitCount: 3, hasMore: false, previousRows: new Map(first.nodes.map((node) => [node.id, node.row!])), previousLanes: new Map(first.tracks.map((track) => [track.id, track.lane])) });
    expect(expanded.nodes.find((node) => node.id === a.id)?.row).toBe(first.nodes.find((node) => node.id === a.id)?.row);
    expect(expanded.nodes.find((node) => node.id === b.id)?.lane).toBe(first.nodes.find((node) => node.id === b.id)?.lane);
  });

  it('keeps feature history on its own lane while anchoring ref events to the destination', () => {
    const base = commitNode('a', 1);
    const feature = { ...commitNode('b', 2), refIds: ['origin/feature'] };
    const head = { ...commitNode('c', 3), refIds: ['main'] };
    const event = {
      id: 'event:feature-reset',
      kind: 'history-event' as const,
      refIds: ['origin/feature'],
      timestamp: 4,
      label: 'reset',
      event: {
        id: 'event:feature-reset',
        type: 'reset' as const,
        refName: 'refs/remotes/origin/feature',
        fromOid: oid('b'),
        toOid: oid('c'),
        timestamp: 4,
      },
    };
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('c') },
      { fullName: 'refs/remotes/origin/feature', shortName: 'origin/feature', type: 'remote' as const, oid: oid('b') },
    ];
    const commits = [
      { oid: oid('c'), parentOids: [oid('b')], subject: 'c', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('b'), parentOids: [oid('a')], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const facts: GraphFactModel = {
      nodes: [head, feature, base, event],
      edges: [],
      refs,
      commits,
      workingTrees: [],
      operations: [],
      events: [event.event!],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    };
    const result = computeLaneLayout(facts);
    expect(result.nodes.find((node) => node.id === event.id)?.trackId).toBe('family:feature');
    expect(result.nodes.find((node) => node.id === event.id)?.lane).toBe(1);
    expect(result.nodes.find((node) => node.id === event.id)?.targetLaneId).toBe('family:feature');
    expect(result.nodes.find((node) => node.id === head.id)?.lane).toBe(0);
    expect(result.nodes.find((node) => node.id === feature.id)?.lane).toBe(1);
  });

  it('hides legacy event source paths so ref moves cannot look like branch edges', () => {
    const source = { ...commitNode('a', 1), lane: 1, row: 3 };
    const sameLaneEvent: GraphNode = { id: 'event:same', kind: 'history-event', lane: 1, row: 1, refIds: [] };
    const crossLaneEvent: GraphNode = { id: 'event:cross', kind: 'history-event', lane: 0, row: 2, refIds: [] };
    const edges = [
      { id: 'event:same:from', type: 'history-event' as const, fromNodeId: source.id, toNodeId: sameLaneEvent.id },
      { id: 'event:same:to', type: 'history-event' as const, fromNodeId: sameLaneEvent.id, toNodeId: source.id },
      { id: 'event:cross:from', type: 'history-event' as const, fromNodeId: source.id, toNodeId: crossLaneEvent.id },
    ];
    const paths: EdgePath[] = edges.map((edge) => ({ ...edge, d: 'M 0 0' }));
    expect(filterRenderableEdgePaths(paths, edges, [source, sameLaneEvent, crossLaneEvent]).map((path) => path.id)).toEqual(['event:same:to']);
  });

  it('renders a ref event as an independent row on the destination ref lane', () => {
    const base = commitNode('a', 1);
    const head = { ...commitNode('b', 2), refIds: ['main'] };
    const event: GraphNode = {
      id: 'event:ff',
      kind: 'fast-forward-event',
      refIds: ['main'],
      timestamp: 3,
      label: 'Fast-forward · main',
      anchorCommitId: head.id,
      targetRef: 'refs/heads/main',
      event: { id: 'event:ff', type: 'fast-forward', refName: 'refs/heads/main', fromOid: oid('a'), toOid: oid('b'), timestamp: 3 },
    };
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('b') }];
    const commits = [
      { oid: oid('b'), parentOids: [oid('a')], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const parentEdge = { id: 'parent:b:a', type: 'parent' as const, fromNodeId: head.id, toNodeId: base.id };
    const baseFacts: GraphFactModel = { nodes: [head, base], edges: [parentEdge], refs, commits, workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const eventFacts: GraphFactModel = {
      ...baseFacts,
      nodes: [head, base, event],
      edges: [parentEdge, { id: 'event:ff:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: event.id, annotation: 'ref-event' }],
      events: [event.event!],
    };
    const withoutEvent = createGraphLayout(baseFacts, { visibleCommitCount: 2, hasMore: false });
    const withEvent = createGraphLayout(eventFacts, { visibleCommitCount: 2, hasMore: false });
    const commitLanes = (layout: ReturnType<typeof createGraphLayout>) => new Map(layout.nodes.filter((node) => node.kind === 'commit').map((node) => [node.id, node.lane]));
    const commitRows = (layout: ReturnType<typeof createGraphLayout>) => new Map(layout.nodes.filter((node) => node.kind === 'commit').map((node) => [node.id, node.row]));
    const eventNode = withEvent.nodes.find((node) => node.id === event.id)!;
    const headNode = withEvent.nodes.find((node) => node.id === head.id)!;
    expect(commitLanes(withEvent)).toEqual(commitLanes(withoutEvent));
    expect(withEvent.tracks.map((track) => [track.id, track.lane])).toEqual(withoutEvent.tracks.map((track) => [track.id, track.lane]));
    expect(commitRows(withEvent).get(head.id)).toBeGreaterThan(commitRows(withoutEvent).get(head.id)!);
    expect(eventNode.anchorCommitId).toBe(head.id);
    expect(eventNode.targetLaneId).toBe('family:main');
    expect(eventNode.row).toBeLessThan(headNode.row!);
    expect(pointForNode(eventNode).x).toBe(pointForNode(headNode).x);
    expect(pointForNode(eventNode).y).not.toBe(pointForNode(headNode).y);
    const ordered = withEvent.nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    expect(ordered.findIndex((node) => node.id === event.id) + 1).toBe(ordered.findIndex((node) => node.id === head.id));
    assertRowInvariants(withEvent.nodes, withEvent.edges);
    expect(withEvent.edges.filter((edge) => edge.type === 'parent').map((edge) => edge.id)).toEqual([parentEdge.id]);
    expect(withEvent.tracks.some((track) => track.id === event.id)).toBe(false);
    const annotation = withEvent.edgePaths?.find((path) => path.annotation === 'ref-event');
    const eventPoint = pointForNode(eventNode);
    const headPoint = pointForNode(headNode);
    expect(annotation?.d).toBe(`M ${headPoint.x} ${headPoint.y} L ${eventPoint.x} ${eventPoint.y}`);
    expect(withEvent.edgePaths?.some((path) => path.id.endsWith(':from'))).toBe(false);
    expect(routeEdges(withEvent.nodes, withEvent.edges).filter((path) => path.annotation === 'ref-event')).toHaveLength(1);
  });

  it('places a completed operation event between the new commit and its parent boundary', () => {
    const base = commitNode('a', 1);
    const parent = { ...commitNode('b', 2), refIds: ['main'] };
    const newCommit = { ...commitNode('c', 3), refIds: ['main'] };
    const event: GraphNode = {
      id: 'event:cherry-pick',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 4,
      label: 'Cherry-pick · main',
      anchorCommitId: newCommit.id,
      eventBoundaryCommitId: parent.id,
      targetRef: 'refs/heads/main',
      event: {
        id: 'event:cherry-pick',
        type: 'cherry-pick',
        refName: 'refs/heads/main',
        fromOid: parent.oid,
        toOid: newCommit.oid!,
        boundaryOid: parent.oid,
        timestamp: 4,
      },
    };
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: newCommit.oid! }];
    const commits = [
      { oid: newCommit.oid!, parentOids: [parent.oid!], subject: 'new', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: parent.oid!, parentOids: [base.oid!], subject: 'old', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: base.oid!, parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const facts: GraphFactModel = {
      nodes: [newCommit, parent, base, event],
      edges: [
        { id: 'parent:c:b', type: 'parent', fromNodeId: newCommit.id, toNodeId: parent.id },
        { id: 'parent:b:a', type: 'parent', fromNodeId: parent.id, toNodeId: base.id },
        { id: 'event:cherry-pick:annotation', type: 'history-event', fromNodeId: newCommit.id, toNodeId: event.id, annotation: 'ref-event' },
      ],
      refs,
      commits,
      workingTrees: [],
      operations: [],
      events: [event.event!],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    };
    const layout = createGraphLayout(facts, { visibleCommitCount: commits.length, hasMore: false });
    const laidOutNew = layout.nodes.find((node) => node.id === newCommit.id)!;
    const laidOutEvent = layout.nodes.find((node) => node.id === event.id)!;
    const laidOutParent = layout.nodes.find((node) => node.id === parent.id)!;

    expect(laidOutEvent).toMatchObject({ anchorCommitId: newCommit.id, eventBoundaryCommitId: parent.id });
    expect(laidOutNew.row).toBeLessThan(laidOutEvent.row!);
    expect(laidOutEvent.row).toBeLessThan(laidOutParent.row!);
    expect(layout.edges.filter((edge) => edge.type === 'parent')).toHaveLength(2);
    expect(layout.edges).not.toContainEqual(expect.objectContaining({ fromNodeId: event.id }));
    const annotation = layout.edgePaths?.find((path) => path.annotation === 'ref-event');
    expect(annotation?.d).toBe(`M ${pointForNode(laidOutNew).x} ${pointForNode(laidOutNew).y} L ${pointForNode(laidOutEvent).x} ${pointForNode(laidOutEvent).y}`);
    assertRowInvariants(layout.nodes, layout.edges);
  });

  it('keeps an Amend event on the live boundary before the old commit side route', () => {
    const base = commitNode('a', 1);
    const parent = { ...commitNode('b', 2), refIds: ['main'] };
    const oldCommit = { ...commitNode('o', 2.5), kind: 'reflog-commit' as const, previousRoute: true };
    const newCommit = { ...commitNode('c', 3), refIds: ['main'] };
    const event: GraphNode = {
      id: 'event:amend',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 4,
      label: 'Amend · main',
      anchorCommitId: newCommit.id,
      eventBoundaryCommitId: parent.id,
      eventStartCommitId: newCommit.id,
      targetRef: 'refs/heads/main',
      event: {
        id: 'event:amend',
        type: 'amend',
        refName: 'refs/heads/main',
        fromOid: oldCommit.oid!,
        toOid: newCommit.oid!,
        boundaryOid: parent.oid,
        eventStartOid: newCommit.oid,
        timestamp: 4,
      },
    };
    const commits = [
      { oid: newCommit.oid!, parentOids: [parent.oid!], subject: 'new', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oldCommit.oid!, parentOids: [parent.oid!], subject: 'old', authorName: 'A', authorDate: 2.5, committerName: 'A', committerDate: 2.5 },
      { oid: parent.oid!, parentOids: [base.oid!], subject: 'parent', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: base.oid!, parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const layout = createGraphLayout({
      nodes: [newCommit, oldCommit, parent, base, event],
      edges: [
        { id: 'parent:new:parent', type: 'parent', fromNodeId: newCommit.id, toNodeId: parent.id },
        { id: 'parent:old:parent', type: 'parent', fromNodeId: oldCommit.id, toNodeId: parent.id },
        { id: 'parent:parent:base', type: 'parent', fromNodeId: parent.id, toNodeId: base.id },
        { id: 'event:amend:annotation', type: 'history-event', fromNodeId: newCommit.id, toNodeId: event.id, annotation: 'ref-event' },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: newCommit.oid! }],
      commits,
      workingTrees: [],
      operations: [],
      events: [event.event!],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    }, { visibleCommitCount: commits.length, hasMore: false });
    const laidOutNew = layout.nodes.find((node) => node.id === newCommit.id)!;
    const laidOutEvent = layout.nodes.find((node) => node.id === event.id)!;
    const laidOutOld = layout.nodes.find((node) => node.id === oldCommit.id)!;
    const laidOutParent = layout.nodes.find((node) => node.id === parent.id)!;

    expect(laidOutNew.row).toBeLessThan(laidOutEvent.row!);
    expect(laidOutEvent.row).toBeLessThan(laidOutOld.row!);
    expect(laidOutOld.row).toBeLessThan(laidOutParent.row!);
    expect(laidOutOld.lane).toBeGreaterThan(laidOutNew.lane!);
    expect(layout.tracks.find((track) => track.id === laidOutOld.trackId)?.family).toBe('historical');
    assertRowInvariants(layout.nodes, layout.edges);
  });

  it('splits a completed single-commit Rebase parent path through the event', () => {
    const facts = rebaseFacts();
    const layout = createGraphLayout(facts, { visibleCommitCount: facts.commits.length, hasMore: false });
    const event = layout.nodes.find((node) => node.event?.type === 'rebase')!;
    const newTip = layout.nodes.find((node) => node.oid === oid('b'))!;
    const newBase = layout.nodes.find((node) => node.oid === oid('a'))!;
    const parentEdge = facts.edges.find((edge) => edge.type === 'parent')!;
    const before = layout.edgePaths?.find((path) => path.id === `${event.id}:rebase:before`);
    const after = layout.edgePaths?.find((path) => path.id === `${event.id}:rebase:after`);

    expect(layout.edges).toContainEqual(parentEdge);
    expect(layout.edgePaths?.some((path) => path.id === parentEdge.id)).toBe(false);
    expect(before).toMatchObject({ type: 'parent', edgeId: parentEdge.id, fromNodeId: newTip.id, toNodeId: event.id });
    expect(after).toMatchObject({ type: 'parent', edgeId: parentEdge.id, fromNodeId: event.id, toNodeId: newBase.id });
    expect(layout.edgePaths?.filter((path) => path.edgeId === parentEdge.id)).toHaveLength(2);
    expect(before?.d.endsWith(`${pointForNode(event).x} ${pointForNode(event).y}`)).toBe(true);
    expect(after?.d.startsWith(`M ${pointForNode(event).x} ${pointForNode(event).y}`)).toBe(true);
    expect(pointForNode(event).x).not.toBe(pointForNode(newTip).x);
    expect(pointForNode(event).x).not.toBe(pointForNode(newBase).x);
    expect(newTip.row).toBeLessThan(event.row!);
    expect(event.row).toBeLessThan(newBase.row!);
  });

  it('splits only the bottom edge of a multi-commit Rebase range', () => {
    const facts = rebaseFacts(true);
    const layout = createGraphLayout(facts, { visibleCommitCount: facts.commits.length, hasMore: false });
    const event = layout.nodes.find((node) => node.event?.type === 'rebase')!;
    const first = layout.nodes.find((node) => node.oid === oid('b'))!;
    const tip = layout.nodes.find((node) => node.oid === oid('c'))!;
    const parentEdges = facts.edges.filter((edge) => edge.type === 'parent');
    const upperEdge = parentEdges.find((edge) => edge.fromNodeId === tip.id)!;
    const bottomEdge = parentEdges.find((edge) => edge.fromNodeId === first.id)!;

    expect(layout.edgePaths?.some((path) => path.id === upperEdge.id)).toBe(true);
    expect(layout.edgePaths?.some((path) => path.id === bottomEdge.id)).toBe(false);
    expect(layout.edgePaths?.filter((path) => path.edgeId === bottomEdge.id)).toHaveLength(2);
    expect(layout.edgePaths).toContainEqual(expect.objectContaining({
      id: `${event.id}:rebase:before`,
      fromNodeId: first.id,
      toNodeId: event.id,
    }));
    expect(layout.edgePaths).toContainEqual(expect.objectContaining({
      id: `${event.id}:rebase:after`,
      fromNodeId: event.id,
      toNodeId: `commit:${oid('a')}`,
    }));
    expect(tip.row).toBeLessThan(first.row!);
    expect(first.row).toBeLessThan(event.row!);
  });

  it('restores the direct Rebase parent path when the event is not present', () => {
    const facts = rebaseFacts();
    const event = facts.nodes.find((node) => node.event?.type === 'rebase')!;
    const parentEdge = facts.edges.find((edge) => edge.type === 'parent')!;
    const withoutReflog = {
      ...facts,
      nodes: facts.nodes.filter((node) => node.id !== event.id),
      edges: facts.edges.filter((edge) => edge.id !== `${event.id}:annotation`),
      events: [],
    };
    const layout = createGraphLayout(withoutReflog, { visibleCommitCount: withoutReflog.commits.length, hasMore: false });

    expect(layout.edgePaths).toContainEqual(expect.objectContaining({ id: parentEdge.id, type: 'parent' }));
    expect(layout.edgePaths?.filter((path) => path.edgeId === parentEdge.id)).toHaveLength(0);
  });

  it('keeps adjacent parent paths joined at the same-lane node center', () => {
    const child = { ...commitNode('a', 3), lane: 0, row: 0 };
    const middle = { ...commitNode('b', 2), lane: 0, row: 1 };
    const parent = { ...commitNode('c', 1), lane: 0, row: 2 };
    const edges = [
      { id: 'parent:a:b', type: 'parent' as const, fromNodeId: child.id, toNodeId: middle.id },
      { id: 'parent:b:c', type: 'parent' as const, fromNodeId: middle.id, toNodeId: parent.id },
    ];
    const paths = routeEdges([child, middle, parent], edges);
    const childPoint = pointForNode(child);
    const middlePoint = pointForNode(middle);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.d.startsWith(`M ${childPoint.x} ${childPoint.y}`)).toBe(true);
    expect(paths[0]?.d.endsWith(`${middlePoint.x} ${middlePoint.y}`)).toBe(true);
    expect(paths[1]?.d.startsWith(`M ${middlePoint.x} ${middlePoint.y}`)).toBe(true);
    expect(paths[1]?.d.endsWith(`${pointForNode(parent).x} ${pointForNode(parent).y}`)).toBe(true);
  });

  it('routes Working Tree around remote-ahead commits to the checked-out HEAD', () => {
    const working: GraphNode = {
      id: 'working:main',
      kind: 'working-tree',
      oid: oid('a'),
      refIds: [],
      row: 0,
      lane: 1,
      workingTree: {
        worktreeId: 'main',
        path: 'C:/repo',
        headOid: oid('a'),
        branch: 'feature',
        detached: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        clean: true,
      },
    };
    const remoteTip = { ...commitNode('c', 4), row: 1, lane: 1 };
    const remoteMiddle = { ...commitNode('b', 3), row: 2, lane: 1 };
    const head = { ...commitNode('a', 2), row: 3, lane: 1 };
    const edge = { id: 'working:main:head', type: 'working-tree' as const, fromNodeId: working.id, toNodeId: head.id };
    const path = routeEdges([working, remoteTip, remoteMiddle, head], [edge], { laneWidth: 34 })[0];
    const workingPoint = pointForNode(working);
    const headPoint = pointForNode(head);
    expect(path?.d.startsWith(`M ${workingPoint.x} ${workingPoint.y}`)).toBe(true);
    expect(path?.d.endsWith(`${headPoint.x} ${headPoint.y}`)).toBe(true);
    expect(path?.d).toContain(`C ${workingPoint.x + 15.3}`);
    expect(path?.d).not.toContain(`C ${workingPoint.x} `);
  });

  it('gives multiple events independent rows while keeping one target lane', () => {
    const head = { ...commitNode('a', 2), refIds: ['main'] };
    const firstEvent: GraphNode = {
      id: 'event:first',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 3,
      label: 'Fast-forward · main',
      anchorCommitId: head.id,
      targetRef: 'refs/heads/main',
      event: { id: 'event:first', type: 'fast-forward', refName: 'refs/heads/main', fromOid: oid('b'), toOid: head.oid!, timestamp: 3 },
    };
    const secondEvent: GraphNode = {
      id: 'event:second',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 4,
      label: 'Reset · main',
      anchorCommitId: head.id,
      targetRef: 'refs/heads/main',
      event: { id: 'event:second', type: 'reset', refName: 'refs/heads/main', fromOid: oid('c'), toOid: head.oid!, timestamp: 4 },
    };
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: head.oid! }];
    const commits = [{ oid: head.oid!, parentOids: [], subject: 'head', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 }];
    const facts: GraphFactModel = {
      nodes: [head, firstEvent, secondEvent],
      edges: [
        { id: 'event:first:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: firstEvent.id, annotation: 'ref-event' },
        { id: 'event:second:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: secondEvent.id, annotation: 'ref-event' },
      ],
      refs,
      commits,
      workingTrees: [],
      operations: [],
      events: [firstEvent.event!, secondEvent.event!],
      primaryBranch: 'main',
      shallowBoundaryOids: [],
    };
    const layout = createGraphLayout(facts, { visibleCommitCount: 1, hasMore: false });
    const first = layout.nodes.find((node) => node.id === firstEvent.id)!;
    const second = layout.nodes.find((node) => node.id === secondEvent.id)!;
    const anchor = layout.nodes.find((node) => node.id === head.id)!;
    expect(first.row).not.toBe(second.row);
    expect(first.row).toBeLessThan(anchor.row!);
    expect(second.row).toBeLessThan(anchor.row!);
    expect(pointForNode(first).x).toBe(pointForNode(anchor).x);
    expect(pointForNode(second).x).toBe(pointForNode(anchor).x);
    assertRowInvariants(layout.nodes, layout.edges);
    expect(routeEdges(layout.nodes, layout.edges).filter((path) => path.annotation === 'ref-event')).toHaveLength(2);
  });

  it('keeps existing event and commit rows stable when an older page is appended', () => {
    const head = { ...commitNode('a', 2), refIds: ['main'] };
    const parent = commitNode('b', 1);
    const event: GraphNode = {
      id: 'event:append',
      kind: 'fast-forward-event',
      refIds: ['main'],
      timestamp: 3,
      label: 'Fast-forward · main',
      anchorCommitId: head.id,
      targetRef: 'refs/heads/main',
      event: { id: 'event:append', type: 'fast-forward', refName: 'refs/heads/main', fromOid: parent.oid!, toOid: head.oid!, timestamp: 3 },
    };
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: head.oid! }];
    const commits = [
      { oid: head.oid!, parentOids: [parent.oid!], subject: 'head', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: parent.oid!, parentOids: [], subject: 'parent', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const firstFacts: GraphFactModel = {
      nodes: [head, event],
      edges: [{ id: 'event:append:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: event.id, annotation: 'ref-event' }],
      refs, commits: commits.slice(0, 1), workingTrees: [], operations: [], events: [event.event!], primaryBranch: 'main', shallowBoundaryOids: [],
    };
    const first = createGraphLayout(firstFacts, { visibleCommitCount: 1, hasMore: true });
    const expanded = createGraphLayout({
      ...firstFacts,
      nodes: [head, parent, event],
      commits,
      edges: [
        { id: 'parent:a:b', type: 'parent' as const, fromNodeId: head.id, toNodeId: parent.id },
        { id: 'event:append:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: event.id, annotation: 'ref-event' },
      ],
    }, {
      visibleCommitCount: 2,
      hasMore: false,
      previousRows: new Map(first.nodes.map((node) => [node.id, node.row!])),
      previousLanes: new Map(first.tracks.map((track) => [track.id, track.lane])),
    });
    for (const id of [event.id, head.id]) {
      expect(expanded.nodes.find((node) => node.id === id)?.row).toBe(first.nodes.find((node) => node.id === id)?.row);
    }
    assertRowInvariants(expanded.nodes, expanded.edges);
  });

  it('does not let an event assign an otherwise unclaimed commit to a branch lane', () => {
    const head = { ...commitNode('a', 2), refIds: ['main'] };
    const orphan = commitNode('b', 1);
    const event: GraphNode = {
      id: 'event:feature-reset',
      kind: 'history-event',
      refIds: ['feature'],
      timestamp: 3,
      label: 'Reset · feature',
      event: { id: 'event:feature-reset', type: 'reset', refName: 'refs/heads/feature', fromOid: orphan.oid!, toOid: head.oid!, timestamp: 3 },
    };
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: head.oid! },
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: head.oid! },
    ];
    const commits = [
      { oid: head.oid!, parentOids: [], subject: 'head', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: orphan.oid!, parentOids: [], subject: 'orphan', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const baseFacts: GraphFactModel = { nodes: [head, orphan], edges: [], refs, commits, workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const eventFacts: GraphFactModel = {
      ...baseFacts,
      nodes: [head, orphan, event],
      edges: [{ id: 'event:feature-reset:annotation', type: 'history-event', fromNodeId: head.id, toNodeId: event.id, annotation: 'ref-event' }],
      events: [event.event!],
    };
    const withoutEvent = createGraphLayout(baseFacts, { visibleCommitCount: 2, hasMore: false });
    const withEvent = createGraphLayout(eventFacts, { visibleCommitCount: 2, hasMore: false });
    expect(withEvent.nodes.find((node) => node.id === orphan.id)?.lane).toBe(withoutEvent.nodes.find((node) => node.id === orphan.id)?.lane);
    expect(withEvent.nodes.find((node) => node.id === orphan.id)?.row).toBeGreaterThan(withEvent.nodes.find((node) => node.id === head.id)?.row ?? -1);
  });
});
