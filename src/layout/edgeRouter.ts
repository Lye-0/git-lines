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
  return {
    // Ref events receive the target ref's lane in laneLayout, so their X is
    // exactly the same as the branch/commit lane.  No annotation offset or
    // temporary lane is introduced here.
    x: leftPadding + (node.lane ?? 0) * laneWidth,
    y: 18 + (node.row ?? 0) * rowHeight,
  };
}

function hasIntermediateNodeOnLane(nodes: GraphNode[], from: GraphNode, to: GraphNode): boolean {
  const fromRow = from.row ?? 0;
  const toRow = to.row ?? 0;
  const firstRow = Math.min(fromRow, toRow);
  const lastRow = Math.max(fromRow, toRow);
  const lane = from.lane;
  return nodes.some((node) => node.id !== from.id && node.id !== to.id
    && node.lane === lane
    && (node.row ?? 0) > firstRow
    && (node.row ?? 0) < lastRow);
}

function routeWorkingTreeEdge(nodes: GraphNode[], from: GraphNode, to: GraphNode, a: { x: number; y: number }, b: { x: number; y: number }, laneWidth: number): string {
  const delta = Math.min(32, Math.max(8, Math.abs(b.y - a.y) * 0.16));
  // A remote-ahead chain can place several commits between the Working Tree
  // row and the checked-out local HEAD on the same branch lane.  Keep the
  // actual HEAD as the endpoint, but bend this presentation-only connector
  // around those nodes so it cannot be mistaken for a connection to the
  // remote tip at the top of the lane.
  if (from.lane === to.lane && hasIntermediateNodeOnLane(nodes, from, to)) {
    const offset = Math.max(10, Math.min(18, laneWidth * 0.45));
    const railX = a.x + offset;
    return `M ${a.x} ${a.y} C ${railX} ${a.y + delta}, ${railX} ${b.y - delta}, ${b.x} ${b.y}`;
  }
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + delta}, ${b.x} ${b.y - delta}, ${b.x} ${b.y}`;
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
      // Keep the connector vertical on the target lane.  In the usual case
      // the destination commit is on that lane too; when lane claiming puts a
      // shared commit elsewhere, this still avoids a branch-like horizontal
      // segment for the presentation-only annotation.
      const d = `M ${b.x} ${a.y} L ${b.x} ${b.y}`;
      return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
    }
    if (edge.type === 'working-tree') {
      const d = routeWorkingTreeEdge(nodes, from, to, a, b, laneWidth);
      return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
    }
    // Keep long branch transitions close to the source/target rows. A
    // distance-proportional control point creates a wide braid when a branch
    // joins an older commit many rows below it.
    const delta = edge.type === 'operation'
      ? Math.min(32, Math.max(8, Math.abs(b.y - a.y) * 0.16))
      : Math.min(56, Math.max(8, Math.abs(b.y - a.y) * 0.28));
    const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + delta}, ${b.x} ${b.y - delta}, ${b.x} ${b.y}`;
    return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
  });
}
