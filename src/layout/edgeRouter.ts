import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { EdgePath } from './layoutTypes.js';

export interface EdgeRouterOptions {
  rowHeight?: number;
  laneWidth?: number;
  leftPadding?: number;
}

export function pointForNode(node: GraphNode, options: EdgeRouterOptions = {}): { x: number; y: number } {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const leftPadding = options.leftPadding ?? 24;
  const eventOffset = node.kind === 'history-event' || node.kind === 'fast-forward-event' ? laneWidth * 0.3 : 0;
  return {
    x: leftPadding + (node.lane ?? 0) * laneWidth + eventOffset,
    y: 18 + (node.row ?? 0) * rowHeight,
  };
}

export function routeEdges(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): EdgePath[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.flatMap((edge) => {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (!from || !to) return [];
    const a = pointForNode(from, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const b = pointForNode(to, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const delta = Math.max(8, Math.abs(b.y - a.y) * 0.42);
    const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + delta}, ${b.x} ${b.y - delta}, ${b.x} ${b.y}`;
    return [{ id: edge.id, type: edge.type, d, label: edge.label }];
  });
}
