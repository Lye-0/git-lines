import type { GraphEdge, GraphNode, HistoryRelation } from '../model/graphModel.js';
import { normalizeRefName } from '../model/refDisplay.js';
import type { EdgePath, HistoryRelationPath } from './layoutTypes.js';

export interface EdgeRouterOptions {
  rowHeight?: number;
  laneWidth?: number;
  leftPadding?: number;
  annotationRows?: ReadonlyMap<string, number>;
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

function historyRelationCurve(a: Point, b: Point): CubicCurve {
  const direction = b.y >= a.y ? 1 : -1;
  const delta = Math.min(42, Math.max(10, Math.abs(b.y - a.y) * 0.2));
  // Let the curve turn toward the target before its final segment.  Keeping
  // this offset small preserves the existing short relation shape while
  // giving the terminal tangent a useful horizontal component when the
  // commits occupy different lanes.
  const lateralDirection = Math.sign(b.x - a.x);
  const lateral = Math.min(18, Math.abs(b.x - a.x) * 0.18);
  return {
    p0: a,
    p1: { x: a.x + lateralDirection * lateral, y: a.y + direction * delta },
    p2: { x: b.x - lateralDirection * lateral, y: b.y - direction * delta },
    p3: b,
  };
}

function cubicDerivative(curve: CubicCurve, t: number): Point {
  const oneMinusT = 1 - t;
  return {
    x: 3 * oneMinusT ** 2 * (curve.p1.x - curve.p0.x)
      + 6 * oneMinusT * t * (curve.p2.x - curve.p1.x)
      + 3 * t ** 2 * (curve.p3.x - curve.p2.x),
    y: 3 * oneMinusT ** 2 * (curve.p1.y - curve.p0.y)
      + 6 * oneMinusT * t * (curve.p2.y - curve.p1.y)
      + 3 * t ** 2 * (curve.p3.y - curve.p2.y),
  };
}

function curvePath(curve: CubicCurve): string {
  return `M ${curve.p0.x} ${curve.p0.y} C ${curve.p1.x} ${curve.p1.y}, ${curve.p2.x} ${curve.p2.y}, ${curve.p3.x} ${curve.p3.y}`;
}

/** Matches the commit node circle radius rendered by GraphSvg. */
export const COMMIT_NODE_RADIUS = 6.5;
/** Keep the overlay arrow small; placement, not size, is what makes it readable. */
export const HISTORY_RELATION_ARROW_SIZE = 3;
/** Visible gap between the arrow tip and the target node disk. */
export const HISTORY_RELATION_ARROW_GAP = 2;
const HISTORY_RELATION_ARROW_LENGTH_RATIO = 1.8;
const HISTORY_RELATION_ARROW_HALF_WIDTH_RATIO = 0.72;

/**
 * Distance from the target commit center to the arrow tip.  The triangle
 * itself extends away from the node along the terminal tangent, so the size
 * parameter is reserved as extra readable clearance rather than as body
 * length toward the node.
 */
export function historyRelationTargetInset(arrowSize = HISTORY_RELATION_ARROW_SIZE): number {
  return COMMIT_NODE_RADIUS + arrowSize + HISTORY_RELATION_ARROW_GAP;
}

function historyRelationSourceInset(): number {
  return COMMIT_NODE_RADIUS + HISTORY_RELATION_ARROW_GAP;
}

function insetPoint(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < Number.EPSILON) return from;
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}

function insetFromAlong(origin: Point, direction: Point, distance: number): Point {
  const length = Math.hypot(direction.x, direction.y);
  if (length < Number.EPSILON) return origin;
  return {
    x: origin.x - (direction.x / length) * distance,
    y: origin.y - (direction.y / length) * distance,
  };
}

function arrowPath(tip: Point, tangent: Point, size = HISTORY_RELATION_ARROW_SIZE): string {
  const length = Math.hypot(tangent.x, tangent.y) || 1;
  const ux = tangent.x / length;
  const uy = tangent.y / length;
  const px = -uy;
  const py = ux;
  const base = { x: tip.x - ux * size * HISTORY_RELATION_ARROW_LENGTH_RATIO, y: tip.y - uy * size * HISTORY_RELATION_ARROW_LENGTH_RATIO };
  const left = { x: base.x + px * size * HISTORY_RELATION_ARROW_HALF_WIDTH_RATIO, y: base.y + py * size * HISTORY_RELATION_ARROW_HALF_WIDTH_RATIO };
  const right = { x: base.x - px * size * HISTORY_RELATION_ARROW_HALF_WIDTH_RATIO, y: base.y - py * size * HISTORY_RELATION_ARROW_HALF_WIDTH_RATIO };
  return `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`;
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

interface BranchRenameVisualSplit {
  event: GraphNode;
  workingEdge: GraphEdge;
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

function findBranchRenameVisualSplits(nodes: GraphNode[], edges: GraphEdge[]): { byWorkingId: Map<string, BranchRenameVisualSplit>; byAnnotationId: Map<string, BranchRenameVisualSplit> } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byWorkingId = new Map<string, BranchRenameVisualSplit>();
  const byAnnotationId = new Map<string, BranchRenameVisualSplit>();
  for (const annotation of edges) {
    if (annotation.annotation !== 'ref-event') continue;
    const event = byId.get(annotation.toNodeId);
    if (event?.event?.type !== 'branch-rename') continue;
    const headId = event.anchorCommitId ?? annotation.fromNodeId;
    const workingEdges = edges.filter((candidate) => candidate.type === 'working-tree'
      && candidate.toNodeId === headId
      && byId.get(candidate.fromNodeId)?.kind === 'working-tree');
    if (workingEdges.length === 0) continue;
    const targetRef = event.targetRef ?? event.event.toRef ?? event.event.refName;
    const matchingWorkingEdges = workingEdges.filter((candidate) => {
      const branch = byId.get(candidate.fromNodeId)?.workingTree?.branch;
      return Boolean(branch && targetRef && normalizeRefName(branch) === normalizeRefName(targetRef));
    });
    const workingEdge = matchingWorkingEdges.length === 1
      ? matchingWorkingEdges[0]
      : workingEdges.length === 1
        ? workingEdges[0]
        : undefined;
    if (!workingEdge) continue;
    const split = { event, workingEdge };
    byWorkingId.set(workingEdge.id, split);
    byAnnotationId.set(annotation.id, split);
  }
  return { byWorkingId, byAnnotationId };
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

/**
 * Places a branch-rename glyph on the existing Working Tree -> HEAD curve.
 * The rename is a ref-name annotation, so its presentation must not create a
 * lane or a second commit-like connector.
 */
export function placeBranchRenameEventsOnWorkingTreeCurves(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): GraphNode[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const splits = findBranchRenameVisualSplits(nodes, edges).byAnnotationId;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const split = [...splits.values()].find((candidate) => candidate.event.id === node.id);
    if (!split) return node;
    const working = byId.get(split.workingEdge.fromNodeId);
    const head = byId.get(split.workingEdge.toNodeId);
    if (!working || !head) return node;
    const curve = workingTreeCurve(nodes, working, head, pointForNode(working, { rowHeight, laneWidth, leftPadding: options.leftPadding }), pointForNode(head, { rowHeight, laneWidth, leftPadding: options.leftPadding }), laneWidth);
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
    && (node.kind === 'commit' || node.kind === 'reflog-commit' || node.kind === 'history-boundary')
    && node.lane === lane
    && (node.row ?? 0) > firstRow
    && (node.row ?? 0) < lastRow);
}

function workingTreeCurve(nodes: GraphNode[], from: GraphNode, to: GraphNode, a: Point, b: Point, laneWidth: number): CubicCurve {
  const delta = Math.min(32, Math.max(8, Math.abs(b.y - a.y) * 0.16));
  // A remote-ahead chain can place several commits between the Working Tree
  // row and the checked-out local HEAD on the same branch lane.  Keep the
  // actual HEAD as the endpoint, but bend this presentation-only connector
  // around those nodes so it cannot be mistaken for a connection to the
  // remote tip at the top of the lane.
  if (from.lane === to.lane && hasIntermediateNodeOnLane(nodes, from, to)) {
    const offset = Math.max(10, Math.min(18, laneWidth * 0.45));
    const railX = a.x + offset;
    return {
      p0: a,
      p1: { x: railX, y: a.y + delta },
      p2: { x: railX, y: b.y - delta },
      p3: b,
    };
  }
  return {
    p0: a,
    p1: { x: a.x, y: a.y + delta },
    p2: { x: b.x, y: b.y - delta },
    p3: b,
  };
}

function routeWorkingTreeEdge(nodes: GraphNode[], from: GraphNode, to: GraphNode, a: { x: number; y: number }, b: { x: number; y: number }, laneWidth: number): string {
  return curvePath(workingTreeCurve(nodes, from, to, a, b, laneWidth));
}

export function routeEdges(nodes: GraphNode[], edges: GraphEdge[], options: EdgeRouterOptions = {}): EdgePath[] {
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rebaseSplits = findRebaseVisualSplits(nodes, edges);
  const branchRenameSplits = findBranchRenameVisualSplits(nodes, edges);
  return edges.flatMap<EdgePath>((edge) => {
    const parentSplit = rebaseSplits.byParentId.get(edge.id);
    if (parentSplit) return [];

    const branchRenameWorkingSplit = branchRenameSplits.byWorkingId.get(edge.id);
    if (branchRenameWorkingSplit) return [];

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

    const branchRenameSplit = branchRenameSplits.byAnnotationId.get(edge.id);
    if (branchRenameSplit) {
      const working = byId.get(branchRenameSplit.workingEdge.fromNodeId);
      const head = byId.get(branchRenameSplit.workingEdge.toNodeId);
      if (!working || !head) return [];
      const curve = workingTreeCurve(
        nodes,
        working,
        head,
        pointForNode(working, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
        pointForNode(head, { rowHeight, laneWidth, leftPadding: options.leftPadding }),
        laneWidth,
      );
      const eventPoint = pointForNode(branchRenameSplit.event, { rowHeight, laneWidth, leftPadding: options.leftPadding });
      const parameter = parameterAtY(curve, eventPoint.y);
      const splitPoint = cubicPoint(curve, parameter);
      const [before, after] = splitCubic(curve, parameter, { x: splitPoint.x, y: eventPoint.y });
      return [
        {
          id: `${branchRenameSplit.event.id}:branch-rename:before`,
          type: 'working-tree',
          d: curvePath(before),
          edgeId: branchRenameSplit.workingEdge.id,
          fromNodeId: branchRenameSplit.workingEdge.fromNodeId,
          toNodeId: branchRenameSplit.event.id,
        },
        {
          id: `${branchRenameSplit.event.id}:branch-rename:after`,
          type: 'working-tree',
          d: curvePath(after),
          edgeId: branchRenameSplit.workingEdge.id,
          fromNodeId: branchRenameSplit.event.id,
          toNodeId: branchRenameSplit.workingEdge.toNodeId,
        },
      ];
    }

    // Ref-only operations live in the post-Working-Tree timeline. Their
    // annotation edge points back to an existing commit only as model
    // metadata; rendering it would create a commit-like stub from the DAG to
    // the operation row. The Working Tree/HEAD visual edge remains intact.
    if (edge.annotation === 'ref-event' && byId.get(edge.toNodeId)?.refOnly === true) return [];

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

/**
 * Routes operation overlays independently from DAG edge routing.  A relation
 * is intentionally omitted when either endpoint is not in the current page;
 * partial arrows and fallback event rows would make pagination misleading.
 */
export function routeHistoryRelations(nodes: GraphNode[], relations: HistoryRelation[], options: EdgeRouterOptions = {}): HistoryRelationPath[] {
  // Relations describe commit-object replacement, never the Working Tree
  // state node, even though that node also carries the current HEAD OID.
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  return relations.flatMap<HistoryRelationPath>((relation) => {
    const source = byOid.get(relation.sourceOid);
    const target = byOid.get(relation.targetOid);
    if (!source || !target) return [];
    const sourcePoint = pointForNode(source, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const targetPoint = pointForNode(target, { rowHeight, laneWidth, leftPadding: options.leftPadding });
    const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
    if (distance < Number.EPSILON) return [];
    // Source keeps the previous node-clearing inset.  The target inset is
    // derived from the commit radius, the small arrow size, and a readable
    // gap so the triangle sits before the node instead of under it.
    const targetInset = Math.min(historyRelationTargetInset(), distance / 2);
    const sourceInset = Math.min(historyRelationSourceInset(), Math.max(0, (distance - targetInset) / 3));
    const start = insetPoint(sourcePoint, targetPoint, sourceInset);
    // Pull the tip back along the real terminal tangent rather than the
    // source-target chord.  After an annotation row the curve is steeper,
    // so a chord inset leaves the arrow overlapping the node disk that is
    // painted above the overlay.
    const approach = cubicDerivative(historyRelationCurve(start, targetPoint), 1);
    const end = insetFromAlong(targetPoint, approach, targetInset);
    const curve = historyRelationCurve(start, end);
    const tangent = cubicDerivative(curve, 1);
    // A virtual annotation row gives the operation text stable vertical
    // space.  Keep its graph marker on the same relation curve; the row never
    // becomes an endpoint or a DAG edge.
    const annotationRow = options.annotationRows?.get(relation.id);
    const labelPoint = annotationRow === undefined
      ? cubicPoint(curve, 0.42)
      : cubicPoint(curve, parameterAtY(curve, 18 + annotationRow * rowHeight));
    return [{
      id: `${relation.id}:overlay`,
      relationId: relation.id,
      kind: relation.kind,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      d: curvePath(curve),
      // The arrow direction is the actual terminal Bezier tangent, not a
      // fixed screen-space angle or a chord approximation.
      arrowD: arrowPath(curve.p3, tangent),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
    }];
  });
}
