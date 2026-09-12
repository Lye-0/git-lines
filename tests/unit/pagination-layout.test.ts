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
