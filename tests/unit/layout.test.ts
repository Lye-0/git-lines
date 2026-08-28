import { describe, expect, it } from 'vitest';
import { assignBranchSegmentLanes, computeLaneLayout } from '../../src/layout/laneLayout.js';
import { computeRowLayout, assertRowInvariants } from '../../src/layout/rowLayout.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { filterRenderableEdgePaths } from '../../src/layout/edgeVisibility.js';
import { pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';
import type { EdgePath } from '../../src/layout/layoutTypes.js';
import type { GraphFactModel, GraphNode } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);
function commitNode(letter: string, date: number): GraphNode { return { id: `commit:${oid(letter)}`, kind: 'commit', oid: oid(letter), refIds: [], timestamp: date, subject: letter }; }

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
      events: [event.event],
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
