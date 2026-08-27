import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { EdgePath } from './layoutTypes.js';

export interface EdgeRouterOptions {
  rowHeight?: number;
  laneWidth?: number;
  leftPadding?: number;
}

export function routeEdges(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): EdgePath[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 28;
  const leftPadding = options.leftPadding ?? 18;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const point = (node: GraphNode) => ({ x: leftPadding + (node.lane ?? 0) * laneWidth, y: 18 + (node.row ?? 0) * rowHeight });
  return edges.flatMap((edge) => {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (!from || !to) return [];
    const a = point(from);
    const b = point(to);
    const delta = Math.max(8, Math.abs(b.y - a.y) * 0.42);
    const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + delta}, ${b.x} ${b.y - delta}, ${b.x} ${b.y}`;
    return [{ id: edge.id, type: edge.type, d, label: edge.label }];
  });
}
