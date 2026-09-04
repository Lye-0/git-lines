import type { CherryPickGroupRelation, GraphEdge, GraphNode, HistoryRelation, RebaseRelation, RefMovementRelation, RewriteCollapseRelation } from '../model/graphModel.js';
import { normalizeRefName } from '../model/refDisplay.js';
import type { EdgePath, HistoryRelationPath, RebaseGroupOutline, RefMovementPath } from './layoutTypes.js';

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

function historyRelationCurve(a: Point, b: Point, lateralNudge = 0): CubicCurve {
  const direction = b.y >= a.y ? 1 : -1;
  const delta = Math.min(42, Math.max(10, Math.abs(b.y - a.y) * 0.2));
  if (lateralNudge !== 0) {
    // Bow the overlay to the message side so a same-lane revert does not sit
    // on the parent edge.  Both controls shift the same way (a C, not an S).
    const bulge = Math.abs(lateralNudge);
    return {
      p0: a,
      p1: { x: a.x + bulge, y: a.y + direction * delta },
      p2: { x: b.x + bulge, y: b.y - direction * delta },
      p3: b,
    };
  }
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

/** Ref Movement uses a deliberately separate geometry contract from history
 * relations: it always has a small, readable bow, even when both endpoints
 * share a lane. */
export const REF_MOVEMENT_MIN_BULGE = 10;
export const REF_MOVEMENT_MAX_BULGE = 24;
export const REF_MOVEMENT_PAIR_SEPARATION = 8;
const REF_MOVEMENT_TARGET_CONTROL_FACTOR = 0.35;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function refMovementBaseBulge(a: Point, b: Point): number {
  const horizontalDistance = Math.abs(b.x - a.x);
  if (horizontalDistance < 1) {
    const verticalDistance = Math.abs(b.y - a.y);
    return verticalDistance >= HISTORY_RELATION_SAME_LANE_MIN_SPAN
      ? HISTORY_RELATION_SAME_LANE_NUDGE
      : REF_MOVEMENT_MIN_BULGE;
  }
  const direction = Math.sign(b.x - a.x);
  return direction * Math.min(18, horizontalDistance * 0.18);
}

/** A single cubic is kept intact so the diamond can sit on a C1-continuous
 * path rather than splitting the relation into two visible segments. */
function refMovementCurve(a: Point, b: Point, lateralOffset: number, sameLane: boolean): CubicCurve {
  const direction = b.y >= a.y ? 1 : -1;
  const delta = Math.min(42, Math.max(10, Math.abs(b.y - a.y) * 0.2));
  const lateral = clamp((sameLane ? refMovementBaseBulge(a, { x: a.x, y: b.y }) : refMovementBaseBulge(a, b)) + lateralOffset, -REF_MOVEMENT_MAX_BULGE, REF_MOVEMENT_MAX_BULGE);
  return {
    p0: a,
    p1: { x: a.x + lateral, y: a.y + direction * delta },
    // Keep most of the bow through the middle of the curve.  Returning the
    // target control toward the target x avoids the inward hook caused by
    // pulling an already inset endpoint back from a full lateral bulge.
    p2: { x: b.x + lateral * REF_MOVEMENT_TARGET_CONTROL_FACTOR, y: b.y - direction * delta },
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
export const HISTORY_RELATION_ARROW_SIZE = 4;
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

/** Half-length of each revert cancel-mark arm. Smaller than the ◇ glyph. */
export const HISTORY_RELATION_CROSS_SIZE = 3.5;
/**
 * Matches the commit selection ring so the revert mark sits outside it.
 * Keep this in lockstep with `NODE_SELECTION_RING_RADIUS`.
 */
export const HISTORY_RELATION_SELECTION_RING = 10;
/** Local horizontal bulge when a same-lane revert would track a parent edge. */
export const HISTORY_RELATION_SAME_LANE_NUDGE = 14;
const HISTORY_RELATION_SAME_LANE_MIN_SPAN = 48;
const SMALL_OVERLAY_NODE_RADIUS = 4;

function overlayEndpointRadius(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): number {
  if (node.kind === 'reflog-commit' && !(node.linkedWorktrees?.length)) return SMALL_OVERLAY_NODE_RADIUS;
  return COMMIT_NODE_RADIUS;
}

/**
 * Distance from the TARGET commit center to the revert ×.  Derived from the
 * visible node disk, the selection ring, the mark size, and a readable gap.
 */
export function historyRelationSourceCrossInset(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): number {
  const outer = Math.max(overlayEndpointRadius(node), HISTORY_RELATION_SELECTION_RING);
  return outer + HISTORY_RELATION_CROSS_SIZE + HISTORY_RELATION_ARROW_GAP;
}

function revertSameLaneNudge(a: Point, b: Point): number {
  if (Math.abs(a.x - b.x) >= 1) return 0;
  if (Math.abs(a.y - b.y) < HISTORY_RELATION_SAME_LANE_MIN_SPAN) return 0;
  return HISTORY_RELATION_SAME_LANE_NUDGE;
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

function insetAlong(origin: Point, direction: Point, distance: number): Point {
  const length = Math.hypot(direction.x, direction.y);
  if (length < Number.EPSILON) return origin;
  return {
    x: origin.x + (direction.x / length) * distance,
    y: origin.y + (direction.y / length) * distance,
  };
}

function crossPath(center: Point, size = HISTORY_RELATION_CROSS_SIZE): string {
  return `M ${center.x - size} ${center.y - size} L ${center.x + size} ${center.y + size} M ${center.x + size} ${center.y - size} L ${center.x - size} ${center.y + size}`;
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
    const annotationRow = options.annotationRows?.get(relation.id);
    const labelFor = (curve: CubicCurve) => annotationRow === undefined
      ? cubicPoint(curve, 0.42)
      : cubicPoint(curve, parameterAtY(curve, 18 + annotationRow * rowHeight));

    if (relation.kind === 'revert') {
      const sourceInset = Math.min(historyRelationSourceCrossInset(source), distance / 2);
      const targetInset = Math.min(
        overlayEndpointRadius(target) + HISTORY_RELATION_ARROW_GAP,
        Math.max(0, (distance - sourceInset) / 2),
      );
      const nudge = revertSameLaneNudge(sourcePoint, targetPoint);
      const draft = historyRelationCurve(sourcePoint, targetPoint, nudge);
      const start = insetAlong(sourcePoint, cubicDerivative(draft, 0), sourceInset);
      const approach = cubicDerivative(historyRelationCurve(start, targetPoint, nudge), 1);
      const end = insetFromAlong(targetPoint, approach, targetInset);
      const curve = historyRelationCurve(start, end, nudge);
      const labelPoint = labelFor(curve);
      return [{
        id: `${relation.id}:overlay`,
        relationId: relation.id,
        kind: relation.kind,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        d: curvePath(curve),
        arrowD: '',
        sourceMarkerD: crossPath(start),
        labelX: labelPoint.x,
        labelY: labelPoint.y,
      }];
    }

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
    const labelPoint = labelFor(curve);
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

/** Gap between the commit disk and the graph-side ref badge. */
export const REF_MOVEMENT_BADGE_GAP = 7;
/** Keep the curve endpoint just outside the badge edge. */
export const REF_MOVEMENT_ANCHOR_GAP = 3;
const REF_BADGE_MAX_WIDTH = 240;
const REF_BADGE_HORIZONTAL_PADDING = 12;
const REF_BADGE_CHARACTER_WIDTH = 7.2;

export function estimatedRefBadgeWidth(name: string, kind: 'local' | 'remote' | 'tag' | 'special' = 'local', isDefault = false): number {
  const tagMarkerWidth = kind === 'tag' ? 14 : 0;
  const defaultSuffixWidth = isDefault ? 70 : 0;
  return Math.min(REF_BADGE_MAX_WIDTH, Math.ceil((name.length * REF_BADGE_CHARACTER_WIDTH) + tagMarkerWidth + defaultSuffixWidth + REF_BADGE_HORIZONTAL_PADDING));
}

/** Compact metrics shared by the graph-side endpoint badge and its anchor. */
export const REF_MOVEMENT_BADGE_MAX_WIDTH = 180;
const REF_MOVEMENT_BADGE_HORIZONTAL_PADDING = 8;
const REF_MOVEMENT_BADGE_CHARACTER_WIDTH = 6.4;

export function estimatedRefMovementBadgeWidth(name: string, kind: 'local' | 'remote' | 'tag' | 'special' = 'local', isDefault = false): number {
  const tagMarkerWidth = kind === 'tag' ? 12 : 0;
  const defaultSuffixWidth = isDefault ? 60 : 0;
  return Math.min(REF_MOVEMENT_BADGE_MAX_WIDTH, Math.ceil((name.length * REF_MOVEMENT_BADGE_CHARACTER_WIDTH) + tagMarkerWidth + defaultSuffixWidth + REF_MOVEMENT_BADGE_HORIZONTAL_PADDING));
}

export function refMovementBadgeOffset(): number {
  return COMMIT_NODE_RADIUS + REF_MOVEMENT_BADGE_GAP;
}

export function refMovementAnchorOffset(badgeWidth: number): number {
  const badgeLeft = refMovementBadgeOffset();
  return badgeLeft + Math.max(0, badgeWidth) * 0.25;
}

/** Default offset for a short local name such as `main`. */
export const REF_MOVEMENT_ANCHOR_OFFSET = refMovementAnchorOffset(estimatedRefMovementBadgeWidth('main'));
const REF_MOVEMENT_ENDPOINT_INSET = HISTORY_RELATION_ARROW_SIZE + HISTORY_RELATION_ARROW_GAP;

export const REF_MOVEMENT_BADGE_HEIGHT = 14 + 1.5 * 2;

/**
 * Places an endpoint on the node-to-badge line. The vertical side is selected
 * from the direction toward the other endpoint, so a downward relation leaves
 * the source below its badge and enters the target above its badge.
 */
export function getRefMovementAnchor(node: GraphNode, otherNode: GraphNode, options: EdgeRouterOptions = {}, badgeWidth = estimatedRefMovementBadgeWidth('main')): { x: number; y: number } {
  const point = pointForNode(node, options);
  const otherPoint = pointForNode(otherNode, options);
  const direction = Math.sign(otherPoint.y - point.y);
  return {
    x: point.x + refMovementAnchorOffset(badgeWidth),
    y: point.y + direction * (REF_MOVEMENT_BADGE_HEIGHT / 2 + REF_MOVEMENT_ANCHOR_GAP),
  };
}

function refMovementPairKey(relation: RefMovementRelation): string {
  return [relation.fromOid, relation.toOid].sort().join('\0');
}

function pairOffsetByRelationId(relations: RefMovementRelation[]): Map<string, number> {
  const groups = new Map<string, RefMovementRelation[]>();
  for (const relation of relations) {
    const group = groups.get(refMovementPairKey(relation)) ?? [];
    group.push(relation);
    groups.set(refMovementPairKey(relation), group);
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    const center = (group.length - 1) / 2;
    group.forEach((relation, index) => {
      offsets.set(relation.id, (index - center) * REF_MOVEMENT_PAIR_SEPARATION);
    });
  }
  return offsets;
}

/**
 * Routes Reset / Branch move overlays between ref-position anchors, not
 * commit-node centers.  Incomplete endpoints are omitted rather than guessed.
 */
export function routeRefMovements(nodes: GraphNode[], relations: RefMovementRelation[], options: EdgeRouterOptions = {}): RefMovementPath[] {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const pairOffsets = pairOffsetByRelationId(relations);
  return relations.flatMap<RefMovementPath>((relation) => {
    const source = byOid.get(relation.fromOid);
    const target = byOid.get(relation.toOid);
    if (!source || !target) return [];
    const badgeWidth = estimatedRefMovementBadgeWidth(normalizeRefName(relation.refName));
    const sourcePoint = getRefMovementAnchor(source, target, { rowHeight, laneWidth, leftPadding: options.leftPadding }, badgeWidth);
    const targetPoint = getRefMovementAnchor(target, source, { rowHeight, laneWidth, leftPadding: options.leftPadding }, badgeWidth);
    const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
    if (distance < Number.EPSILON) return [];
    const annotationRow = options.annotationRows?.get(relation.id);
    const labelFor = (curve: CubicCurve) => annotationRow === undefined
      ? cubicPoint(curve, 0.42)
      : cubicPoint(curve, parameterAtY(curve, 18 + annotationRow * rowHeight));
    const targetInset = Math.min(REF_MOVEMENT_ENDPOINT_INSET, distance / 2);
    const sourceInset = Math.min(HISTORY_RELATION_ARROW_GAP, Math.max(0, (distance - targetInset) / 3));
    const pairOffset = pairOffsets.get(relation.id) ?? 0;
    const sameLane = Math.abs(targetPoint.x - sourcePoint.x) < 1;
    const start = insetPoint(sourcePoint, targetPoint, sourceInset);
    // Iterate the endpoint inset against the actual cubic tangent.  This
    // keeps the arrow tip outside the ref anchor without replacing the
    // single smooth path with a second segment.
    let curve = refMovementCurve(start, targetPoint, pairOffset, sameLane);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const end = insetFromAlong(targetPoint, cubicDerivative(curve, 1), targetInset);
      curve = refMovementCurve(start, end, pairOffset, sameLane);
    }
    const tangent = cubicDerivative(curve, 1);
    const labelPoint = labelFor(curve);
    return [{
      id: `${relation.id}:ref-move`,
      relationId: relation.id,
      kind: relation.kind,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      d: curvePath(curve),
      arrowD: arrowPath(curve.p3, tangent),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
    }];
  });
}

export const REBASE_GROUP_PADDING = 8;

export interface RebaseGroupBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function roundedRectPath(bounds: RebaseGroupBounds, radius = 8): string {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const r = Math.min(radius, width / 2, height / 2);
  const x = bounds.minX;
  const y = bounds.minY;
  return `M ${x + r} ${y} H ${x + width - r} Q ${x + width} ${y} ${x + width} ${y + r} V ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height} H ${x + r} Q ${x} ${y + height} ${x} ${y + height - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
}

export function rebaseGroupBounds(nodes: GraphNode[], oids: string[], options: EdgeRouterOptions = {}): RebaseGroupBounds | undefined {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const members = oids.map((oid) => byOid.get(oid)).filter((node): node is GraphNode => Boolean(node));
  if (members.length !== oids.length || members.length === 0) return undefined;
  const points = members.map((node) => pointForNode(node, options));
  const pad = overlayEndpointRadius(members[0]) + REBASE_GROUP_PADDING;
  return {
    minX: Math.min(...points.map((point) => point.x)) - pad,
    maxX: Math.max(...points.map((point) => point.x)) + pad,
    minY: Math.min(...points.map((point) => point.y)) - pad,
    maxY: Math.max(...points.map((point) => point.y)) + pad,
  };
}

function rectBoundaryPoint(bounds: RebaseGroupBounds, from: Point, toward: Point): Point {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (Math.hypot(dx, dy) < Number.EPSILON) return { x: cx, y: cy };
  const candidates: Point[] = [];
  if (dx !== 0) {
    for (const x of [bounds.minX, bounds.maxX]) {
      const t = (x - from.x) / dx;
      if (t < 0 || t > 1) continue;
      const y = from.y + dy * t;
      if (y >= bounds.minY - 0.01 && y <= bounds.maxY + 0.01) candidates.push({ x, y });
    }
  }
  if (dy !== 0) {
    for (const y of [bounds.minY, bounds.maxY]) {
      const t = (y - from.y) / dy;
      if (t < 0 || t > 1) continue;
      const x = from.x + dx * t;
      if (x >= bounds.minX - 0.01 && x <= bounds.maxX + 0.01) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return { x: cx, y: cy };
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.x - toward.x, best.y - toward.y);
    const nextDistance = Math.hypot(candidate.x - toward.x, candidate.y - toward.y);
    return nextDistance < bestDistance ? candidate : best;
  });
}

function rebaseLabelPoint(curve: CubicCurve, annotationRow: number | undefined, rowHeight: number): Point {
  const labelY = annotationRow === undefined ? cubicPoint(curve, 0.42).y : 18 + annotationRow * rowHeight;
  const onCurve = cubicPoint(curve, parameterAtY(curve, labelY));
  return { x: onCurve.x, y: labelY };
}

function rebaseGroupConnector(start: Point, rawEnd: Point, markerY: number | undefined): CubicCurve {
  const endY = rawEnd.y;
  const startY = start.y;
  const through = markerY !== undefined
    && markerY > Math.min(startY, endY)
    && markerY < Math.max(startY, endY)
    ? {
      x: start.x + (rawEnd.x - start.x) * ((markerY - startY) / (endY - startY)),
      y: markerY,
    }
    : undefined;
  const draft = through
    ? {
      p0: start,
      p1: { x: start.x + (through.x - start.x) * 0.55, y: start.y + (through.y - start.y) * 0.55 },
      p2: { x: rawEnd.x + (through.x - rawEnd.x) * 0.55, y: rawEnd.y + (through.y - rawEnd.y) * 0.55 },
      p3: rawEnd,
    }
    : historyRelationCurve(start, rawEnd);
  const distance = Math.hypot(rawEnd.x - start.x, rawEnd.y - start.y);
  const end = insetFromAlong(rawEnd, cubicDerivative(draft, 1), Math.min(HISTORY_RELATION_ARROW_SIZE + HISTORY_RELATION_ARROW_GAP, distance / 3));
  if (!through) return historyRelationCurve(start, end);
  return {
    p0: start,
    p1: { x: start.x + (through.x - start.x) * 0.55, y: start.y + (through.y - start.y) * 0.55 },
    p2: { x: end.x + (through.x - end.x) * 0.55, y: end.y + (through.y - end.y) * 0.55 },
    p3: end,
  };
}

function routeMemberGroupOverlay(
  nodes: GraphNode[],
  spec: {
    id: string;
    kind: HistoryRelationPath['kind'];
    sourceOids: string[];
    targetOids: string[];
    sourceTipOid: string;
    targetTipOid: string;
    sourceRole: RebaseGroupOutline['role'];
    targetRole: RebaseGroupOutline['role'];
  },
  options: EdgeRouterOptions,
  byOid: Map<string, GraphNode>,
): { path: HistoryRelationPath; outlines: RebaseGroupOutline[] } | undefined {
  const source = byOid.get(spec.sourceTipOid);
  const target = byOid.get(spec.targetTipOid);
  if (!source || !target) return undefined;
  if ([...spec.sourceOids, ...spec.targetOids].some((oid) => !byOid.has(oid))) return undefined;
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const routedOptions = { rowHeight, laneWidth, leftPadding: options.leftPadding };
  const sourceBounds = rebaseGroupBounds(nodes, spec.sourceOids, routedOptions);
  const targetBounds = rebaseGroupBounds(nodes, spec.targetOids, routedOptions);
  if (!sourceBounds || !targetBounds) return undefined;
  const sourceCenter = { x: (sourceBounds.minX + sourceBounds.maxX) / 2, y: (sourceBounds.minY + sourceBounds.maxY) / 2 };
  const targetCenter = { x: (targetBounds.minX + targetBounds.maxX) / 2, y: (targetBounds.minY + targetBounds.maxY) / 2 };
  const start = rectBoundaryPoint(sourceBounds, sourceCenter, targetCenter);
  const rawEnd = rectBoundaryPoint(targetBounds, targetCenter, sourceCenter);
  const distance = Math.hypot(rawEnd.x - start.x, rawEnd.y - start.y);
  if (distance < Number.EPSILON) return undefined;
  const annotationRow = options.annotationRows?.get(spec.id);
  const markerY = annotationRow === undefined ? undefined : 18 + annotationRow * rowHeight;
  const curve = rebaseGroupConnector(start, rawEnd, markerY);
  const tangent = cubicDerivative(curve, 1);
  const labelPoint = rebaseLabelPoint(curve, annotationRow, rowHeight);
  return {
    outlines: [
      { id: `${spec.id}:${spec.sourceRole}-group`, relationId: spec.id, role: spec.sourceRole, d: roundedRectPath(sourceBounds) },
      { id: `${spec.id}:${spec.targetRole}-group`, relationId: spec.id, role: spec.targetRole, d: roundedRectPath(targetBounds) },
    ],
    path: {
      id: `${spec.id}:overlay`,
      relationId: spec.id,
      kind: spec.kind,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      d: curvePath(curve),
      arrowD: arrowPath(curve.p3, tangent),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
    },
  };
}

/**
 * Routes completed Rebase overlays.  A single-commit rewrite uses the commit
 * relation curve.  A multi-commit rewrite outlines each linear group and
 * connects group boundaries, never commit centers.
 */
export function routeRebaseRelations(
  nodes: GraphNode[],
  relations: RebaseRelation[],
  options: EdgeRouterOptions = {},
): { paths: HistoryRelationPath[]; outlines: RebaseGroupOutline[] } {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const paths: HistoryRelationPath[] = [];
  const outlines: RebaseGroupOutline[] = [];

  for (const relation of relations) {
    const source = byOid.get(relation.oldTipOid);
    const target = byOid.get(relation.newTipOid);
    if (!source || !target) continue;
    const missingMember = [...relation.oldOids, ...relation.newOids].some((oid) => !byOid.has(oid));
    if (missingMember) continue;
    const grouped = relation.oldOids.length > 1 || relation.newOids.length > 1;

    if (!grouped) {
      const [path] = routeHistoryRelations(nodes, [{
        id: relation.id,
        kind: 'amend',
        sourceOid: relation.oldTipOid,
        targetOid: relation.newTipOid,
        timestamp: relation.timestamp,
        evidence: 'reflog',
      }], options);
      if (!path) continue;
      paths.push({ ...path, kind: 'rebase' });
      continue;
    }

    const overlay = routeMemberGroupOverlay(nodes, {
      id: relation.id,
      kind: 'rebase',
      sourceOids: relation.oldOids,
      targetOids: relation.newOids,
      sourceTipOid: relation.oldTipOid,
      targetTipOid: relation.newTipOid,
      sourceRole: 'old',
      targetRole: 'new',
    }, options, byOid);
    if (!overlay) continue;
    outlines.push(...overlay.outlines);
    paths.push(overlay.path);
  }

  return { paths, outlines };
}

/**
 * Routes grouped exact Cherry-pick overlays.  Membership is always 2+
 * mappings; singles stay on HistoryRelation curves.
 */
export function routeCherryPickGroups(
  nodes: GraphNode[],
  relations: CherryPickGroupRelation[],
  options: EdgeRouterOptions = {},
): { paths: HistoryRelationPath[]; outlines: RebaseGroupOutline[] } {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const paths: HistoryRelationPath[] = [];
  const outlines: RebaseGroupOutline[] = [];
  for (const relation of relations) {
    const overlay = routeMemberGroupOverlay(nodes, {
      id: relation.id,
      kind: 'cherry-pick-group',
      sourceOids: relation.sourceOids,
      targetOids: relation.targetOids,
      sourceTipOid: relation.sourceTipOid,
      targetTipOid: relation.targetTipOid,
      sourceRole: 'source',
      targetRole: 'target',
    }, options, byOid);
    if (!overlay) continue;
    outlines.push(...overlay.outlines);
    paths.push(overlay.path);
  }
  return { paths, outlines };
}

/**
 * Routes contiguous squash/fixup overlays: OLD GROUP outline only, then a
 * boundary connector to the single NEW commit disk.  The new commit is not
 * wrapped in a one-commit group box.
 */
export function routeRewriteCollapseRelations(
  nodes: GraphNode[],
  relations: RewriteCollapseRelation[],
  options: EdgeRouterOptions = {},
): { paths: HistoryRelationPath[]; outlines: RebaseGroupOutline[] } {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const paths: HistoryRelationPath[] = [];
  const outlines: RebaseGroupOutline[] = [];
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const routedOptions = { rowHeight, laneWidth, leftPadding: options.leftPadding };

  for (const relation of relations) {
    const source = byOid.get(relation.oldTipOid);
    const target = byOid.get(relation.newOid);
    if (!source || !target) continue;
    if ([...relation.oldOids, relation.newOid].some((oid) => !byOid.has(oid))) continue;
    const sourceBounds = rebaseGroupBounds(nodes, relation.oldOids, routedOptions);
    if (!sourceBounds) continue;
    const sourceCenter = { x: (sourceBounds.minX + sourceBounds.maxX) / 2, y: (sourceBounds.minY + sourceBounds.maxY) / 2 };
    const targetPoint = pointForNode(target, routedOptions);
    const start = rectBoundaryPoint(sourceBounds, sourceCenter, targetPoint);
    const facing = insetAlong(targetPoint, { x: start.x - targetPoint.x, y: start.y - targetPoint.y }, overlayEndpointRadius(target));
    const distance = Math.hypot(facing.x - start.x, facing.y - start.y);
    if (distance < Number.EPSILON) continue;
    const annotationRow = options.annotationRows?.get(relation.id);
    const markerY = annotationRow === undefined ? undefined : 18 + annotationRow * rowHeight;
    const curve = rebaseGroupConnector(start, facing, markerY);
    const tangent = cubicDerivative(curve, 1);
    const labelPoint = rebaseLabelPoint(curve, annotationRow, rowHeight);
    outlines.push({ id: `${relation.id}:old-group`, relationId: relation.id, role: 'old', d: roundedRectPath(sourceBounds) });
    paths.push({
      id: `${relation.id}:overlay`,
      relationId: relation.id,
      kind: relation.kind,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      d: curvePath(curve),
      arrowD: arrowPath(curve.p3, tangent),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
    });
  }
  return { paths, outlines };
}
