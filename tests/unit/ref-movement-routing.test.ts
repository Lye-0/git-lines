import { describe, expect, it } from 'vitest';
import {
  estimatedRefBadgeWidth,
  estimatedRefMovementBadgeWidth,
  getRefMovementAnchor,
  HISTORY_RELATION_SAME_LANE_NUDGE,
  REF_MOVEMENT_ANCHOR_GAP,
  REF_MOVEMENT_BADGE_HEIGHT,
  REF_MOVEMENT_MAX_BULGE,
  REF_MOVEMENT_MIN_BULGE,
  REF_MOVEMENT_PAIR_SEPARATION,
  pointForNode,
  refMovementAnchorOffset,
  refMovementBadgeOffset,
  routeHistoryRelations,
  routeRefMovements,
} from '../../src/layout/edgeRouter.js';
import type { GraphNode, HistoryRelation, RefMovementRelation } from '../../src/model/graphModel.js';
import { graphWidthForLayout } from '../../webview/src/components/graphMetrics';
import { operationKindLabel } from '../../webview/src/components/operationPresentation';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, row: number, lane = 0): GraphNode {
  return {
    id: `commit:${letter}`,
    kind: 'commit',
    oid: oid(letter),
    refIds: [],
    refBadges: [{ fullName: 'refs/heads/main', name: 'main', kind: 'local' }],
    row,
    lane,
    subject: letter,
  };
}

function movement(id: string, kind: RefMovementRelation['kind'], from: string, to: string): RefMovementRelation {
  return {
    id,
    kind,
    refName: 'refs/heads/main',
    fromOid: oid(from),
    toOid: oid(to),
    timestamp: 1,
    evidence: 'reflog',
  };
}

function pathNumbers(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function cubic(path: string): { p0: Point; p1: Point; p2: Point; p3: Point } {
  const numbers = pathNumbers(path);
  return {
    p0: { x: numbers[0]!, y: numbers[1]! },
    p1: { x: numbers[2]!, y: numbers[3]! },
    p2: { x: numbers[4]!, y: numbers[5]! },
    p3: { x: numbers[6]!, y: numbers[7]! },
  };
}

interface Point {
  x: number;
  y: number;
}

function cubicPoint(curve: { p0: Point; p1: Point; p2: Point; p3: Point }, t: number): Point {
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

function arrowVertices(path: string): Point[] {
  const numbers = pathNumbers(path);
  return [
    { x: numbers[0]!, y: numbers[1]! },
    { x: numbers[2]!, y: numbers[3]! },
    { x: numbers[4]!, y: numbers[5]! },
  ];
}

describe('ref movement routing', () => {
  it('FP1: graph-side endpoint metrics are smaller than normal message-side metrics', () => {
    expect(estimatedRefMovementBadgeWidth('main')).toBeLessThan(estimatedRefBadgeWidth('main'));
    expect(estimatedRefMovementBadgeWidth('main')).toBe(34);
    expect(estimatedRefBadgeWidth('main')).toBe(41);
  });

  it('FP2: normal message-side badge metrics remain unchanged', () => {
    expect(estimatedRefBadgeWidth('feature')).toBe(63);
    expect(estimatedRefBadgeWidth('release/2026')).toBe(99);
  });

  it('FP3: current and ghost endpoint badges share the same compact geometry', () => {
    const currentBadge = { name: 'main', kind: 'local' as const, isDefault: false };
    const ghostBadge = { name: 'main', kind: 'local' as const, isDefault: false };
    const metric = (badge: typeof currentBadge) => estimatedRefMovementBadgeWidth(badge.name, badge.kind, badge.isDefault);
    expect(metric(currentBadge)).toBe(metric(ghostBadge));
  });

  it('FP4: the movement anchor follows the compact graph-side badge bounds', () => {
    const source = commit('a', 0);
    const target = commit('b', 6);
    const point = pointForNode(source);
    const anchor = getRefMovementAnchor(source, target);
    const badgeLeft = point.x + refMovementBadgeOffset();
    const badgeCenter = badgeLeft + estimatedRefMovementBadgeWidth('main') / 2;
    expect(anchor.x).toBe(badgeLeft + estimatedRefMovementBadgeWidth('main') * 0.25);
    expect(anchor.x).toBeLessThan(badgeCenter);
    expect(anchor.x - point.x).toBe(refMovementAnchorOffset(estimatedRefMovementBadgeWidth('main')));
    expect(anchor.y).toBe(point.y + REF_MOVEMENT_BADGE_HEIGHT / 2 + REF_MOVEMENT_ANCHOR_GAP);
  });

  it('A3: an upward-moving endpoint uses the badge top gap', () => {
    const source = commit('b', 6);
    const target = commit('a', 0);
    const point = pointForNode(source);
    const anchor = getRefMovementAnchor(source, target);
    expect(anchor.y).toBe(point.y - REF_MOVEMENT_BADGE_HEIGHT / 2 - REF_MOVEMENT_ANCHOR_GAP);
  });

  it('A4/A5: both endpoint sides use the movement direction and keep a visual gap', () => {
    const source = commit('a', 0);
    const target = commit('b', 6);
    const sourcePoint = pointForNode(source);
    const targetPoint = pointForNode(target);
    const sourceAnchor = getRefMovementAnchor(source, target);
    const targetAnchor = getRefMovementAnchor(target, source);
    expect(sourceAnchor.y).toBeGreaterThan(sourcePoint.y);
    expect(targetAnchor.y).toBeLessThan(targetPoint.y);
    expect(sourceAnchor.y - sourcePoint.y).toBe(REF_MOVEMENT_BADGE_HEIGHT / 2 + REF_MOVEMENT_ANCHOR_GAP);
    expect(targetPoint.y - targetAnchor.y).toBe(REF_MOVEMENT_BADGE_HEIGHT / 2 + REF_MOVEMENT_ANCHOR_GAP);
  });

  it('RRV1: separates reciprocal movements while preserving each direction', () => {
    const nodes = [commit('a', 0), commit('b', 6)];
    const relations = [movement('branch:a:b', 'branch-move', 'a', 'b'), movement('reset:b:a', 'reset', 'b', 'a')];
    const paths = routeRefMovements(nodes, relations);

    expect(paths).toHaveLength(2);
    expect(paths.map((path) => [path.sourceNodeId, path.targetNodeId])).toEqual([
      ['commit:a', 'commit:b'],
      ['commit:b', 'commit:a'],
    ]);
    expect(paths[0]?.d).not.toBe(paths[1]?.d);
    const first = cubic(paths[0]!.d);
    const second = cubic(paths[1]!.d);
    expect(Math.abs((first.p1.x - first.p0.x) - (second.p1.x - second.p0.x))).toBe(REF_MOVEMENT_PAIR_SEPARATION);
    expect(getRefMovementAnchor(nodes[0]!, nodes[1]!)).toEqual(getRefMovementAnchor(nodes[0]!, nodes[1]!));
    expect(getRefMovementAnchor(nodes[1]!, nodes[0]!)).toEqual(getRefMovementAnchor(nodes[1]!, nodes[0]!));
  });

  it('RRV2: separates same-pair same-direction relations too', () => {
    const nodes = [commit('a', 0), commit('b', 6)];
    const paths = routeRefMovements(nodes, [
      movement('reset:a:b', 'reset', 'a', 'b'),
      movement('branch:a:b', 'branch-move', 'a', 'b'),
    ]);

    expect(paths).toHaveLength(2);
    expect(paths[0]?.d).not.toBe(paths[1]?.d);
    expect(Math.abs(cubic(paths[1]!.d).p1.x - cubic(paths[0]!.d).p1.x)).toBe(REF_MOVEMENT_PAIR_SEPARATION);
  });

  it('RRV3: keeps the marker on one C1-continuous cubic path', () => {
    const [path] = routeRefMovements(
      [commit('a', 0), commit('b', 8)],
      [movement('reset:a:b', 'reset', 'a', 'b')],
      { annotationRows: new Map([['reset:a:b', 4]]) },
    );
    const curve = cubic(path!.d);
    expect(path!.d.match(/[MC]/g)).toEqual(['M', 'C']);
    let closest = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 1000; index += 1) {
      const point = cubicPoint(curve, index / 1000);
      closest = Math.min(closest, Math.hypot(point.x - path!.labelX, point.y - path!.labelY));
    }
    expect(closest).toBeLessThan(1);
  });

  it('RRV4: aligns the arrow with the terminal cubic tangent', () => {
    const source = commit('a', 0);
    const target = commit('b', 8);
    const [path] = routeRefMovements([source, target], [movement('reset:a:b', 'reset', 'a', 'b')]);
    const curve = cubic(path!.d);
    const [tip, left, right] = arrowVertices(path!.arrowD);
    const base = { x: (left!.x + right!.x) / 2, y: (left!.y + right!.y) / 2 };
    const tangent = { x: curve.p3.x - curve.p2.x, y: curve.p3.y - curve.p2.y };
    const arrow = { x: tip!.x - base.x, y: tip!.y - base.y };
    expect(tangent.x * arrow.y - tangent.y * arrow.x).toBeCloseTo(0, 8);
    expect(tangent.x * arrow.x + tangent.y * arrow.y).toBeGreaterThan(0);
    const targetAnchor = getRefMovementAnchor(target, source);
    expect(Math.abs(tip!.x - targetAnchor.x)).toBeLessThan(2);
    const targetBadgeTop = pointForNode(target).y - REF_MOVEMENT_BADGE_HEIGHT / 2;
    expect(tip!.y).toBeLessThan(targetBadgeTop);
    expect(targetBadgeTop - tip!.y).toBeLessThan(10);
  });

  it('RRV5: gives a short same-lane movement a minimum bulge', () => {
    const [path] = routeRefMovements([commit('a', 0), commit('b', 1)], [movement('reset:a:b', 'reset', 'a', 'b')]);
    const curve = cubic(path!.d);
    expect(Math.abs(curve.p1.x - curve.p0.x)).toBeGreaterThanOrEqual(REF_MOVEMENT_MIN_BULGE);
  });

  it('FP5: keeps the short same-lane curve flowing toward the target', () => {
    const [path] = routeRefMovements([commit('a', 0), commit('b', 6)], [movement('reset:a:b', 'reset', 'a', 'b')]);
    const curve = cubic(path!.d);
    const incoming = { x: curve.p1.x - curve.p0.x, y: curve.p1.y - curve.p0.y };
    const terminal = { x: curve.p3.x - curve.p2.x, y: curve.p3.y - curve.p2.y };
    expect(incoming.y).toBeGreaterThan(0);
    expect(terminal.y).toBeGreaterThan(0);
    expect(Math.abs(terminal.x)).toBeLessThan(Math.abs(terminal.y));
  });

  it('RRV6: clamps long same-lane bulge and keeps the existing obstacle offset bounded', () => {
    const [path] = routeRefMovements([commit('a', 0), commit('b', 80)], [movement('reset:a:b', 'reset', 'a', 'b')]);
    const curve = cubic(path!.d);
    expect(Math.abs(curve.p1.x - curve.p0.x)).toBeLessThanOrEqual(REF_MOVEMENT_MAX_BULGE);
    expect(Math.abs(curve.p1.x - curve.p0.x)).toBe(HISTORY_RELATION_SAME_LANE_NUDGE);
  });

  it('RRV7: reserves graph width for the full Branch move label', () => {
    const nodes = [commit('a', 0), commit('b', 8)];
    const relation = movement('branch:a:b', 'branch-move', 'a', 'b');
    const [path] = routeRefMovements(nodes, [relation]);
    const width = graphWidthForLayout({
      nodes,
      laneWidth: 34,
      rowHeight: 38,
      refMovementRelations: [relation],
      refMovementPaths: [path!],
    });
    const labelWidth = operationKindLabel('branch-move').length * 7.2;
    expect(width).toBeGreaterThanOrEqual(Math.ceil(path!.labelX + 10 + 6 + labelWidth + 14));
    expect(operationKindLabel('branch-move')).toBe('Branch move');
  });

  it('RRV8: uses the same width calculation for Reset and Branch move', () => {
    const nodes = [commit('a', 0), commit('b', 8)];
    const reset = movement('reset:a:b', 'reset', 'a', 'b');
    const branchMove = movement('branch:a:b', 'branch-move', 'a', 'b');
    const resetPath = routeRefMovements(nodes, [reset])[0]!;
    const branchPath = routeRefMovements(nodes, [branchMove])[0]!;
    const resetWidth = graphWidthForLayout({ nodes, laneWidth: 34, rowHeight: 38, refMovementRelations: [reset], refMovementPaths: [resetPath] });
    const branchWidth = graphWidthForLayout({ nodes, laneWidth: 34, rowHeight: 38, refMovementRelations: [branchMove], refMovementPaths: [branchPath] });
    expect(branchWidth).toBeGreaterThan(resetWidth);
  });

  it('RRV9: does not mutate DAG node positions while routing a movement', () => {
    const nodes = [commit('a', 0, 1), commit('b', 8, 2)];
    const before = nodes.map((node) => ({ id: node.id, row: node.row, lane: node.lane, visualX: node.visualX }));
    routeRefMovements(nodes, [movement('reset:a:b', 'reset', 'a', 'b')]);
    expect(nodes.map((node) => ({ id: node.id, row: node.row, lane: node.lane, visualX: node.visualX }))).toEqual(before);
  });

  it('RRV10: preserves the pure DAG router contract when no movements are supplied', () => {
    const nodes = [commit('a', 0), commit('b', 1)];
    expect(routeRefMovements(nodes, [])).toEqual([]);
  });

  it('RRV11: leaves HistoryRelation routing separate from Ref Movement routing', () => {
    const source = commit('a', 6);
    const target = commit('b', 0);
    const history: HistoryRelation = {
      id: 'amend:a:b',
      kind: 'amend',
      sourceOid: source.oid!,
      targetOid: target.oid!,
      timestamp: 1,
      evidence: 'reflog',
    };
    const historyPath = routeHistoryRelations([source, target], [history])[0]!;
    const movementPath = routeRefMovements([source, target], [movement('reset:a:b', 'reset', 'a', 'b')])[0]!;
    expect(historyPath.kind).toBe('amend');
    expect(movementPath.kind).toBe('reset');
    expect(historyPath.d).not.toBe(movementPath.d);
  });
});
