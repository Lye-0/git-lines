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
  // Ref events sit beside the commit lane.  The offset is deliberately less
  // than one full lane so an annotation never claims or creates a branch
  // lane of its own.
  const eventOffset = node.kind === 'history-event' || node.kind === 'fast-forward-event'
    ? laneWidth * 0.8 + Math.max(0, node.annotationOffsetX ?? 0)
    : 0;
  return {
    x: leftPadding + (node.lane ?? 0) * laneWidth + eventOffset,
    y: 18 + (node.row ?? 0) * rowHeight,
  };
}

export function routeEdges(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): EdgePath[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.flatMap<EdgePath>((edge) => {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (!from || !to) return [];
    const a = pointForNode(from, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const b = pointForNode(to, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    if (edge.annotation === 'ref-event') {
      // Ref events are horizontal annotations at the event's own time row.
      // The commit lane supplies the x anchor; no vertical segment reaches
      // the event glyph, so it cannot look like a small branch.
      const d = `M ${a.x} ${b.y} H ${b.x}`;
      return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
    }
    // Keep long branch transitions close to the source/target rows. A
    // distance-proportional control point creates a wide braid when a branch
    // joins an older commit many rows below it.
    const delta = edge.type === 'working-tree' || edge.type === 'operation'
      ? Math.min(32, Math.max(8, Math.abs(b.y - a.y) * 0.16))
      : Math.min(56, Math.max(8, Math.abs(b.y - a.y) * 0.28));
    const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + delta}, ${b.x} ${b.y - delta}, ${b.x} ${b.y}`;
    return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
  });
}
