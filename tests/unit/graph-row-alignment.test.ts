import { describe, expect, it } from 'vitest';
import { pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';
import type { GraphNode } from '../../src/model/graphModel.js';

describe('graph vertical alignment', () => {
  it.each([28, 30, 38])('aligns nodes and edge endpoints for %ipx rows', (rowHeight) => {
    const nodes: GraphNode[] = [
      { id: 'child', kind: 'commit', refIds: [], row: 1, lane: 0 },
      { id: 'parent', kind: 'commit', refIds: [], row: 4, lane: 0 },
    ];
    const offset = rowHeight === 38 ? 18 : rowHeight / 2;
    const start = pointForNode(nodes[0], { rowHeight });
    const end = pointForNode(nodes[1], { rowHeight });
    expect(start).toEqual({ x: 24, y: rowHeight + offset });
    expect(end).toEqual({ x: 24, y: 4 * rowHeight + offset });
    const [edge] = routeEdges(nodes, [{ id: 'edge', fromNodeId: 'child', toNodeId: 'parent', type: 'parent' }], { rowHeight });
    expect(edge.d.startsWith(`M ${start.x} ${start.y}`)).toBe(true);
    expect(edge.d.endsWith(`${end.x} ${end.y}`)).toBe(true);
  });
});
