import { expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../../src/model/graphModel.js';
import { placeFastForwardEventsOnCurves, pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';

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
  const placed = placeFastForwardEventsOnCurves(nodes, edges);
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
  const placed = placeFastForwardEventsOnCurves(nodes, edges);
  expect(placed).toEqual(nodes);
  expect(routeEdges(placed, edges).filter((p) => p.annotation === 'ref-event')).toHaveLength(2);
});

it.each([3, 20])('uses the actual parent curve after main advances, including long routes (row %i)', (endRow) => {
  const { nodes, edges } = fixture();
  nodes[0] = { id: 'wt', kind: 'commit', row: 0, lane: 0, trackId: 'main', refIds: [],
    commit: { oid: 'later', parentOids: ['head'], subject: 'later', authorName: 'A', committerName: 'A', authorDate: 1, committerDate: 1 } };
  nodes[3].oid = 'head'; nodes[3].row = endRow;
  nodes[1].trackId = 'main'; nodes[2].trackId = 'main';
  edges[0].type = 'parent';
  const placed = placeFastForwardEventsOnCurves(nodes, edges);
  const paths = routeEdges(placed, edges);
  expect(paths).toHaveLength(1);
  expect(paths[0].id).toBe('checkout');
  // Sample the rendered cubic segments independently and compare with glyphs.
  const numbers = paths[0].d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  for (const event of placed.slice(1, 3)) {
    const p = pointForNode(event);
    let distance = Infinity, x = numbers[0], y = numbers[1];
    for (let i = 2; i + 5 < numbers.length; i += 6) {
      for (let step = 0; step <= 10000; step++) {
        const t = step / 10000, u = 1 - t;
        const px = u ** 3 * x + 3 * u ** 2 * t * numbers[i] + 3 * u * t ** 2 * numbers[i + 2] + t ** 3 * numbers[i + 4];
        const py = u ** 3 * y + 3 * u ** 2 * t * numbers[i + 1] + 3 * u * t ** 2 * numbers[i + 3] + t ** 3 * numbers[i + 5];
        distance = Math.min(distance, Math.hypot(px - p.x, py - p.y));
      }
      x = numbers[i + 4]; y = numbers[i + 5];
    }
    expect(distance).toBeLessThan(0.1);
  }
  // A parent on another branch must not silently absorb the main FF marker.
  nodes[0].trackId = 'other';
  expect(placeFastForwardEventsOnCurves(nodes, edges)).toEqual(nodes);
});
