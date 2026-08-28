import { describe, expect, it } from 'vitest';
import { computeLaneLayout } from '../../src/layout/laneLayout.js';
import { computeRowLayout, assertRowInvariants } from '../../src/layout/rowLayout.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { filterRenderableEdgePaths } from '../../src/layout/edgeVisibility.js';
import { pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';
import type { EdgePath } from '../../src/layout/layoutTypes.js';
import type { GraphFactModel, GraphNode } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);
function commitNode(letter: string, date: number): GraphNode { return { id: `commit:${oid(letter)}`, kind: 'commit', oid: oid(letter), refIds: [], timestamp: date, subject: letter }; }

describe('graph layout', () => {
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
    expect(result.nodes.find((node) => node.id === event.id)?.lane).toBe(0);
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

  it('renders a ref event as one horizontal annotation without changing commit lanes or parent edges', () => {
    const base = commitNode('a', 1);
    const head = { ...commitNode('b', 2), refIds: ['main'] };
    const event: GraphNode = {
      id: 'event:ff',
      kind: 'fast-forward-event',
      refIds: ['main'],
      timestamp: 3,
      label: 'Fast-forward · main',
      anchorCommitId: head.id,
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
    expect(commitRows(withEvent)).toEqual(commitRows(withoutEvent));
    expect(eventNode.anchorCommitId).toBe(head.id);
    expect(eventNode.row).toBe(headNode.row);
    expect(pointForNode(eventNode).y).toBe(pointForNode(headNode).y);
    assertRowInvariants(withEvent.nodes, withEvent.edges);
    expect(withEvent.edges.filter((edge) => edge.type === 'parent').map((edge) => edge.id)).toEqual([parentEdge.id]);
    expect(withEvent.edgePaths?.find((path) => path.id === parentEdge.id)?.d).toBe(withoutEvent.edgePaths?.find((path) => path.id === parentEdge.id)?.d);
    expect(withEvent.tracks.some((track) => track.id === event.id)).toBe(false);
    const annotation = withEvent.edgePaths?.find((path) => path.annotation === 'ref-event');
    expect(annotation?.d).toContain(' H ');
    expect(annotation?.d).not.toContain(' V ');
    expect(withEvent.edgePaths?.some((path) => path.id.endsWith(':from'))).toBe(false);
    expect(routeEdges(withEvent.nodes, withEvent.edges).filter((path) => path.annotation === 'ref-event')).toHaveLength(1);
  });

  it('keeps multiple events on one anchor row and separates their annotation labels horizontally', () => {
    const head = { ...commitNode('a', 2), refIds: ['main'] };
    const firstEvent: GraphNode = {
      id: 'event:first',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 3,
      label: 'Fast-forward · main',
      anchorCommitId: head.id,
      annotationOffsetX: 0,
      event: { id: 'event:first', type: 'fast-forward', refName: 'refs/heads/main', fromOid: oid('b'), toOid: head.oid!, timestamp: 3 },
    };
    const secondEvent: GraphNode = {
      id: 'event:second',
      kind: 'history-event',
      refIds: ['main'],
      timestamp: 4,
      label: 'Reset · main',
      anchorCommitId: head.id,
      annotationOffsetX: 220,
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
    expect(first.row).toBe(anchor.row);
    expect(second.row).toBe(anchor.row);
    expect(pointForNode(first).x).toBeLessThan(pointForNode(second).x);
    expect(routeEdges(layout.nodes, layout.edges).filter((path) => path.annotation === 'ref-event')).toHaveLength(2);
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
    expect(withEvent.nodes.find((node) => node.id === orphan.id)?.row).toBe(withoutEvent.nodes.find((node) => node.id === orphan.id)?.row);
  });
});
