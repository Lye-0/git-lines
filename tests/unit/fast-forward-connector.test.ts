import { expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../src/model/graphModel.js';
import { placeFastForwardEventsOnWorkingTreeCurves, pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';

function fixture() {
  const nodes: GraphNode[] = [
    { id: 'wt', kind: 'working-tree', row: 0, lane: 0, refIds: [], timestamp: 0,
      workingTree: { worktreeId: 'wt', path: '/repo', headOid: 'head', branch: 'main', detached: false, clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } },
    ...[1, 2].map((row): GraphNode => ({ id: `ff${row}`, kind: 'fast-forward-event', row, lane: 0, targetRef: 'refs/heads/main', anchorCommitId: 'head', refIds: [], timestamp: 0 })),
    { id: 'head', kind: 'commit', row: 3, lane: 1, refIds: [], timestamp: 0 },
  ];
  const edges: GraphEdge[] = [
    { id: 'checkout', type: 'working-tree', fromNodeId: 'wt', toNodeId: 'head' },
    ...[1, 2].map((i): GraphEdge => ({ id: `annotation${i}`, type: 'history-event', annotation: 'ref-event', fromNodeId: 'head', toNodeId: `ff${i}` })),
  ];
  return { nodes, edges };
}

it('places multiple FF diamonds on one unchanged checkout curve without duplicate connectors', () => {
  const { nodes, edges } = fixture();
  const original = routeEdges(nodes, [edges[0]])[0];
  const placed = placeFastForwardEventsOnWorkingTreeCurves(nodes, edges);
  expect(routeEdges(placed, edges)).toEqual([original]);
  const first = pointForNode(placed[1]), second = pointForNode(placed[2]);
  expect(first.x).toBeGreaterThan(pointForNode(placed[0]).x);
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.x).toBeLessThan(pointForNode(placed[3]).x);
  expect(placed.map((n) => [n.id, n.row, n.lane])).toEqual(nodes.map((n) => [n.id, n.row, n.lane]));
});

it.each(['different-branch', 'outside-connector', 'no-checkout'])('retains standalone FF annotations when no matching connector exists: %s', (reason) => {
  const { nodes, edges } = fixture();
  if (reason === 'different-branch') nodes[0].workingTree!.branch = 'other';
  if (reason === 'outside-connector') nodes[0].row = 4;
  if (reason === 'no-checkout') edges.shift();
  const placed = placeFastForwardEventsOnWorkingTreeCurves(nodes, edges);
  expect(placed).toEqual(nodes);
  expect(routeEdges(placed, edges).filter((p) => p.annotation === 'ref-event')).toHaveLength(2);
});
