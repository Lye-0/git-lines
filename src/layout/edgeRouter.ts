import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { EdgePath } from './layoutTypes.js';

export interface EdgeRouterOptions {
  rowHeight?: number;
  laneWidth?: number;
  leftPadding?: number;
}

interface Point {
  x: number;
  y: number;
}

interface CubicCurve {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

export function pointForNode(node: GraphNode, options: EdgeRouterOptions = {}): { x: number; y: number } {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const leftPadding = options.leftPadding ?? 24;
  return {
    // Most nodes are positioned by their lane. A completed Rebase event is
    // the one exception: its layout X is placed on the existing live parent
    // curve so the glyph is an insertion point, not a second branch lane.
    x: node.visualX ?? leftPadding + (node.lane ?? 0) * laneWidth,
    y: 18 + (node.row ?? 0) * rowHeight,
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicPoint(curve: CubicCurve, t: number): Point {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT ** 3 * curve.p0.x
      + 3 * oneMinusT ** 2 * t * curve.p1.x
      + 3 * oneMinusT * t ** 2 * curve.p2.x
      + t ** 3 * curve.p3.x,
    y: oneMinusT ** 3 * curve.p0.y
      + 3 * oneMinusT ** 2 * t * curve.p1.y
      + 3 * oneMinusT * t ** 2 * curve.p2.y
      + t ** 3 * curve.p3.y,
  };
}

function parentCurve(a: Point, b: Point): CubicCurve {
  const delta = Math.min(56, Math.max(8, Math.abs(b.y - a.y) * 0.28));
  return {
    p0: a,
    p1: { x: a.x, y: a.y + delta },
    p2: { x: b.x, y: b.y - delta },
    p3: b,
  };
}

function operationCurve(a: Point, b: Point): CubicCurve {
  const delta = Math.min(32, Math.max(8, Math.abs(b.y - a.y) * 0.16));
  return {
    p0: a,
    p1: { x: a.x, y: a.y + delta },
    p2: { x: b.x, y: b.y - delta },
    p3: b,
  };
}

function curvePath(curve: CubicCurve): string {
  return `M ${curve.p0.x} ${curve.p0.y} C ${curve.p1.x} ${curve.p1.y}, ${curve.p2.x} ${curve.p2.y}, ${curve.p3.x} ${curve.p3.y}`;
}

function splitCubic(curve: CubicCurve, t: number, boundary: Point): [CubicCurve, CubicCurve] {
  const ab = lerp(curve.p0, curve.p1, t);
  const bc = lerp(curve.p1, curve.p2, t);
  const cd = lerp(curve.p2, curve.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  return [
    { p0: curve.p0, p1: ab, p2: abc, p3: boundary },
    { p0: boundary, p1: bcd, p2: cd, p3: curve.p3 },
  ];
}

function parameterAtY(curve: CubicCurve, y: number): number {
  const startY = curve.p0.y;
  const endY = curve.p3.y;
  if (Math.abs(endY - startY) < Number.EPSILON) return 0.5;
  const targetY = Math.max(Math.min(startY, endY), Math.min(Math.max(startY, endY), y));
  const increasing = endY > startY;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 32; index += 1) {
    const middle = (low + high) / 2;
    const middleY = cubicPoint(curve, middle).y;
    if (increasing ? middleY < targetY : middleY > targetY) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

interface RebaseVisualSplit {
  event: GraphNode;
  parentEdge: GraphEdge;
}

function findRebaseVisualSplits(nodes: GraphNode[], edges: GraphEdge[]): { byParentId: Map<string, RebaseVisualSplit>; byAnnotationId: Map<string, RebaseVisualSplit> } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byParentId = new Map<string, RebaseVisualSplit>();
  const byAnnotationId = new Map<string, RebaseVisualSplit>();
  for (const annotation of edges) {
    if (annotation.annotation !== 'ref-event') continue;
    const event = byId.get(annotation.toNodeId);
    if (event?.event?.type !== 'rebase') continue;
    const childId = event.eventStartCommitId ?? annotation.fromNodeId;
    const boundaryId = event.eventBoundaryCommitId;
    if (!boundaryId) continue;
    const parentEdge = edges.find((candidate) => candidate.type === 'parent'
      && candidate.fromNodeId === childId
      && candidate.toNodeId === boundaryId);
    if (!parentEdge || !byId.has(childId) || !byId.has(boundaryId)) continue;
    const split = { event, parentEdge };
    byParentId.set(parentEdge.id, split);
    byAnnotationId.set(annotation.id, split);
  }
  return { byParentId, byAnnotationId };
}

/**
 * Places completed Rebase event glyphs on the existing lowest-range parent
 * curve. The lane remains the event's live branch lane for identity/color;
 * this presentation-only X does not create or reserve another lane.
 */
export function placeRebaseEventsOnParentCurves(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): GraphNode[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const splits = findRebaseVisualSplits(nodes, edges).byAnnotationId;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const split = [...splits.values()].find((candidate) => candidate.event.id === node.id);
    if (!split) return node;
    const child = byId.get(split.parentEdge.fromNodeId);
    const boundary = byId.get(split.parentEdge.toNodeId);
    if (!child || !boundary) return node;
    const curve = parentCurve(
      pointForNode(child, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
      pointForNode(boundary, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
    );
    const eventPoint = pointForNode(node, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const point = cubicPoint(curve, parameterAtY(curve, eventPoint.y));
    return { ...node, visualX: point.x };
  });
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
  const rebaseSplits = findRebaseVisualSplits(nodes, edges);
  return edges.flatMap<EdgePath>((edge) => {
    const parentSplit = rebaseSplits.byParentId.get(edge.id);
    if (parentSplit) return [];

    const annotationSplit = rebaseSplits.byAnnotationId.get(edge.id);
    if (annotationSplit) {
      const child = byId.get(annotationSplit.parentEdge.fromNodeId);
      const boundary = byId.get(annotationSplit.parentEdge.toNodeId);
      if (!child || !boundary) return [];
      const curve = parentCurve(
        pointForNode(child, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
        pointForNode(boundary, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
      );
      const eventPoint = pointForNode(annotationSplit.event, { rowHeight, laneWidth, leftPadding: options.leftPadding });
      const parameter = parameterAtY(curve, eventPoint.y);
      const splitPoint = cubicPoint(curve, parameter);
      const [before, after] = splitCubic(curve, parameter, { x: splitPoint.x, y: eventPoint.y });
      return [
        {
          id: `${annotationSplit.event.id}:rebase:before`,
          type: 'parent',
          d: curvePath(before),
          edgeId: annotationSplit.parentEdge.id,
          fromNodeId: annotationSplit.parentEdge.fromNodeId,
          toNodeId: annotationSplit.event.id,
        },
        {
          id: `${annotationSplit.event.id}:rebase:after`,
          type: 'parent',
          d: curvePath(after),
          edgeId: annotationSplit.parentEdge.id,
          fromNodeId: annotationSplit.event.id,
          toNodeId: annotationSplit.parentEdge.toNodeId,
        },
      ];
    }

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
    const curve = edge.type === 'operation' ? operationCurve(a, b) : parentCurve(a, b);
    const d = curvePath(curve);
    return [{ id: edge.id, type: edge.type, d, label: edge.label, annotation: edge.annotation }];
  });
}
