import { describe, expect, it } from 'vitest';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { LayoutState } from '../../src/layout/layoutState.js';
import { assertRowInvariants, computeRowLayout } from '../../src/layout/rowLayout.js';
import type { GraphFactModel, GraphNode } from '../../src/model/graphModel.js';

function page(count: number, annotation: boolean): GraphFactModel {
  const all = ['a', 'b', 'c', 'd', 'e', 'f'];
  const parents: Record<string, string[]> = { a: ['d'], b: ['e'], c: ['f'], d: [], e: [], f: [] };
  const visible = all.slice(0, count);
  const commits = visible.map((oid, index) => ({ oid, parentOids: parents[oid], subject: oid, authorName: 'A', committerName: 'A', authorDate: 10 - index, committerDate: 10 - index }));
  const nodes: GraphNode[] = commits.map((commit) => ({ id: `commit:${commit.oid}`, kind: 'commit', oid: commit.oid, timestamp: commit.committerDate, refIds: [] }));
  const edges = commits.flatMap((commit) => commit.parentOids.map((parent) => {
    const loaded = visible.includes(parent);
    const target = `${loaded ? 'commit' : 'boundary'}:${parent}`;
    if (!loaded && !nodes.some((node) => node.id === target)) nodes.push({ id: target, kind: 'history-boundary', oid: parent, timestamp: 0, refIds: [] });
    return { id: `parent:${commit.oid}:${parent}`, type: 'parent' as const, fromNodeId: `commit:${commit.oid}`, toNodeId: target };
  }));
  return { nodes, edges, commits, refs: [], workingTrees: [], operations: [], events: [], shallowBoundaryOids: [],
    historyRelations: annotation ? [{ id: 'amend', kind: 'amend', sourceOid: 'b', targetOid: 'a', timestamp: 10, evidence: 'reflog' }] : [] };
}

describe('pagination boundary rows', () => {
  it.each(['unreferenced', 'deleted-branch', 'previous'] as const)('continues %s history into its unread parent without bowing across live commits', (kind) => {
    const commits = Array.from({ length: 15 }, (_, index) => ({ oid: `live${index}`, parentOids: [index === 14 ? 'unread-live' : `live${index + 1}`], subject: 'live', authorName: 'A', committerName: 'A', authorDate: 100 - index, committerDate: 100 - index }));
    commits.unshift({ ...commits[0], oid: 'main', parentOids: ['unread-main', 'live0'], committerDate: 102 });
    commits.push({ ...commits[0], oid: 'old', parentOids: ['unread-old'], committerDate: 99.5 });
    const nodes: GraphNode[] = commits.map((commit) => ({ id: `commit:${commit.oid}`, oid: commit.oid, kind: commit.oid === 'old' ? 'reflog-commit' : 'commit', refIds: [], timestamp: commit.committerDate,
      ...(commit.oid === 'old' ? { historicalKind: kind, historicalRouteId: 'history:old', historicalRouteHead: true, previousRoute: kind === 'previous' } : {}) }));
    for (const oid of ['unread-main', 'unread-live', 'unread-old']) nodes.push({ id: `boundary:${oid}`, oid, kind: 'history-boundary', refIds: [], timestamp: 0 });
    const facts: GraphFactModel = { nodes, commits, edges: commits.flatMap((commit) => commit.parentOids.map((oid) => ({ id: `parent:${commit.oid}:${oid}`, type: 'parent', fromNodeId: `commit:${commit.oid}`, toNodeId: `${oid.startsWith('unread') ? 'boundary' : 'commit'}:${oid}` }))),
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: 'main' }, { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: 'live0' }],
      primaryBranch: 'main', workingTrees: [], operations: [], shallowBoundaryOids: [],
      events: kind === 'previous' ? [{ id: 'amend:old', type: 'amend', refName: 'refs/heads/feature', fromOid: 'old', toOid: 'live0', timestamp: 103 }] : [] };
    const layout = createGraphLayout(facts, { visibleCommitCount: 16, hasMore: true, primaryBranch: 'main' });
    const old = layout.nodes.find((node) => node.oid === 'old')!;
    const boundary = layout.nodes.find((node) => node.oid === 'unread-old')!;
    expect(boundary.trackId).toBe(old.trackId);
    expect(boundary.lane).toBe(old.lane);
    expect(boundary.lane).toBeGreaterThan(0);
    const path = layout.edgePaths!.find((edge) => edge.id === 'parent:old:unread-old')!.d;
    const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // Every point on this cubic has the same X, not merely its endpoints.
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const x = (1 - t) ** 3 * values[0] + 3 * (1 - t) ** 2 * t * values[2] + 3 * (1 - t) * t ** 2 * values[4] + t ** 3 * values[6];
      expect(x).toBeCloseTo(values[0]);
    }
    expect(layout.edges).toEqual(facts.edges);
    assertRowInvariants(layout.nodes, facts.edges);
    // Once loaded, the actual parent can join main: the temporary side route
    // must not override evidence from the live ancestry.
    const expanded = structuredClone(facts);
    expanded.nodes = expanded.nodes.filter((node) => node.oid !== 'unread-old');
    expanded.nodes.push({ id: 'commit:unread-old', oid: 'unread-old', kind: 'commit', refIds: [], timestamp: 1 });
    expanded.commits.push({ ...commits[0], oid: 'unread-old', parentOids: [], committerDate: 1 });
    expanded.commits.find((commit) => commit.oid === 'main')!.parentOids[0] = 'unread-old';
    expanded.edges = expanded.edges.map((edge) => edge.toNodeId === boundary.id ? { ...edge, toNodeId: 'commit:unread-old' } : edge);
    expanded.edges = expanded.edges.map((edge) => edge.id === 'parent:main:unread-main' ? { ...edge, id: 'parent:main:unread-old', toNodeId: 'commit:unread-old' } : edge);
    const state = new LayoutState();
    state.set(layout);
    const loaded = createGraphLayout(expanded, { visibleCommitCount: 17, hasMore: true, primaryBranch: 'main', previousRows: state.rows, previousLanes: state.lanes, previousNodeLanes: state.nodeLanes });
    expect(loaded.nodes.find((node) => node.oid === 'unread-old')?.lane).toBe(0);
    expect(loaded.edges.find((edge) => edge.id === 'parent:old:unread-old')?.toNodeId).toBe('commit:unread-old');
    expect(loaded.nodes.find((node) => node.id === old.id)?.lane).toBe(old.lane);
  });

  it.each([false, true])('reclaims placeholders across repeated appends (annotation=%s)', (annotation) => {
    const state = new LayoutState();
    for (const count of [3, 4, 5, 6]) {
      const facts = page(count, annotation);
      const before = state.layout;
      const layout = createGraphLayout(facts, { visibleCommitCount: count, hasMore: count < 6,
        previousRows: before ? state.rows : undefined, previousLanes: state.lanes, previousNodeLanes: state.nodeLanes });
      assertRowInvariants(layout.nodes, facts.edges);
      for (const old of before?.nodes.filter((node) => node.kind === 'commit') ?? []) {
        const current = layout.nodes.find((node) => node.id === old.id)!;
        expect([current.row, current.lane]).toEqual([old.row, old.lane]);
      }
      const occupied = [...layout.nodes.map((node) => node.row!), ...(layout.operationAnnotationRows ?? []).map((row) => row.row)].sort((a, b) => a - b);
      expect(occupied).toEqual(Array.from({ length: occupied.length }, (_, index) => index));
      expect(layout.edges.filter((edge) => edge.type === 'parent').map((edge) => [edge.id, edge.fromNodeId, edge.toNodeId])).toEqual(facts.edges.map((edge) => [edge.id, edge.fromNodeId, edge.toNodeId]));
      expect(layout.operationAnnotationRows).toHaveLength(annotation ? 1 : 0);
      state.set(layout);
      expect([...state.rows.keys()].some((id) => id.startsWith('boundary:'))).toBe(false);
    }
  });

  it('releases pinned child constraints before ordering a page with skewed dates', () => {
    const nodes: GraphNode[] = ['a', 'b', 'c'].map((id, index) => ({ id, kind: 'commit', refIds: [], timestamp: index + 1 }));
    const edges = [{ id: 'ab', type: 'parent' as const, fromNodeId: 'a', toNodeId: 'b' }, { id: 'bc', type: 'parent' as const, fromNodeId: 'b', toNodeId: 'c' }];
    const result = computeRowLayout(nodes, edges, new Map([['a', 0]]));
    expect(result.nodes.map((node) => node.row)).toEqual([0, 1, 2]);
    assertRowInvariants(result.nodes, edges);
  });
});
