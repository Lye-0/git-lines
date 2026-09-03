import { describe, expect, it } from 'vitest';
import {
  COMMIT_NODE_RADIUS,
  HISTORY_RELATION_ARROW_GAP,
  HISTORY_RELATION_ARROW_SIZE,
  HISTORY_RELATION_CROSS_SIZE,
  HISTORY_RELATION_SAME_LANE_NUDGE,
  HISTORY_RELATION_SELECTION_RING,
  historyRelationSourceCrossInset,
  historyRelationTargetInset,
  pointForNode,
  routeHistoryRelations,
} from '../../src/layout/edgeRouter.js';
import type { GraphNode, HistoryRelation } from '../../src/model/graphModel.js';
import { NODE_SELECTION_RING_RADIUS, SMALL_COMMIT_NODE_RADIUS } from '../../webview/src/components/nodePresentation';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, row: number, lane: number): GraphNode {
  return { id: `commit:${letter}`, kind: 'commit', oid: oid(letter), refIds: [], row, lane, subject: letter };
}

function amend(source: GraphNode, target: GraphNode, id = 'amend:one'): HistoryRelation {
  return { id, kind: 'amend', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
}

function cherryPick(source: GraphNode, target: GraphNode, id = 'cherry:one'): HistoryRelation {
  return { id, kind: 'cherry-pick', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
}

function revert(source: GraphNode, target: GraphNode, id = 'revert:one'): HistoryRelation {
  return { id, kind: 'revert', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
}

function svgPathNumbers(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function firstSvgPoint(path: string): { x: number; y: number } {
  const numbers = svgPathNumbers(path);
  return { x: numbers[0], y: numbers[1] };
}

function lastSvgPoint(path: string): { x: number; y: number } {
  const numbers = svgPathNumbers(path);
  return { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
}

function arrowVertices(arrowD: string): Array<{ x: number; y: number }> {
  const numbers = svgPathNumbers(arrowD);
  return [
    { x: numbers[0], y: numbers[1] },
    { x: numbers[2], y: numbers[3] },
    { x: numbers[4], y: numbers[5] },
  ];
}

function assertArrowClearsTarget(source: GraphNode, target: GraphNode, annotationRow?: number) {
  const annotationRows = annotationRow === undefined ? undefined : new Map([['amend:one', annotationRow]]);
  const [path] = routeHistoryRelations([source, target], [amend(source, target)], { annotationRows });
  expect(path).toBeDefined();
  const targetPoint = pointForNode(target);
  const sourcePoint = pointForNode(source);
  const tip = firstSvgPoint(path.arrowD);
  const lineEnd = lastSvgPoint(path.d);
  const vertices = arrowVertices(path.arrowD);
  const base = { x: (vertices[1].x + vertices[2].x) / 2, y: (vertices[1].y + vertices[2].y) / 2 };
  const towardTarget = { x: targetPoint.x - tip.x, y: targetPoint.y - tip.y };
  const alongArrow = { x: tip.x - base.x, y: tip.y - base.y };
  const tipDistance = Math.hypot(tip.x - targetPoint.x, tip.y - targetPoint.y);

  expect(lineEnd).toEqual(tip);
  expect(tipDistance).toBeGreaterThan(COMMIT_NODE_RADIUS + HISTORY_RELATION_ARROW_GAP - 0.05);
  expect(vertices.every((vertex) => Math.hypot(vertex.x - targetPoint.x, vertex.y - targetPoint.y) > COMMIT_NODE_RADIUS)).toBe(true);
  expect(towardTarget.x * alongArrow.x + towardTarget.y * alongArrow.y).toBeGreaterThan(0);
  expect(Math.hypot(tip.x - sourcePoint.x, tip.y - sourcePoint.y)).toBeGreaterThan(COMMIT_NODE_RADIUS);
  return path;
}

describe('history relation arrow geometry', () => {
  it('derives the target inset from node radius, arrow size, and a visible gap', () => {
    expect(HISTORY_RELATION_ARROW_SIZE).toBe(4);
    expect(historyRelationTargetInset()).toBe(COMMIT_NODE_RADIUS + HISTORY_RELATION_ARROW_SIZE + HISTORY_RELATION_ARROW_GAP);
    expect(historyRelationTargetInset()).toBe(12.5);
  });

  it('clears the target node when NEW sits above-left of OLD after an annotation row', () => {
    const target = commit('n', 0, 0);
    const source = commit('o', 2, 1);
    const path = assertArrowClearsTarget(source, target, 1);
    expect(path.labelY).toBeCloseTo(pointForNode({ ...target, row: 1 }).y, 5);
    expect(firstSvgPoint(path.arrowD).y).toBeLessThan(pointForNode(source).y);
    expect(firstSvgPoint(path.arrowD).x).toBeLessThan(pointForNode(source).x);
  });

  it('clears the target node when NEW sits above-right of OLD', () => {
    assertArrowClearsTarget(commit('o', 3, 0), commit('n', 0, 2), 1);
  });

  it('clears the target node on a nearly vertical same-lane relation', () => {
    assertArrowClearsTarget(commit('o', 6, 0), commit('n', 0, 0), 3);
  });

  it('clears the target node on a nearly horizontal relation', () => {
    assertArrowClearsTarget(commit('o', 2, 0), commit('n', 2, 4));
  });

  it('keeps the arrow outside the target node when the endpoints are close', () => {
    assertArrowClearsTarget(commit('o', 1, 0), commit('n', 0, 0));
  });

  it('keeps the arrow outside the target node when the endpoints are far apart', () => {
    assertArrowClearsTarget(commit('o', 18, 3), commit('n', 0, 0), 9);
  });

  it('emits a single overlay path for one visible relation', () => {
    const source = commit('o', 2, 1);
    const target = commit('n', 0, 0);
    const paths = routeHistoryRelations(
      [source, target],
      [amend(source, target)],
      { annotationRows: new Map([['amend:one', 1]]) },
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]?.relationId).toBe('amend:one');
    expect(paths.map((path) => path.id)).toEqual(['amend:one:overlay']);
  });
});

describe('revert overlay markers', () => {
  function cubicControls(path: string): { start: { x: number; y: number }; c1: { x: number; y: number } } {
    const numbers = svgPathNumbers(path);
    return {
      start: { x: numbers[0], y: numbers[1] },
      c1: { x: numbers[2], y: numbers[3] },
    };
  }

  function crossCenter(sourceMarkerD: string): { x: number; y: number } {
    const numbers = svgPathNumbers(sourceMarkerD);
    return { x: (numbers[0] + numbers[2]) / 2, y: (numbers[1] + numbers[3]) / 2 };
  }

  it('places a cancel mark at TARGET and omits the triangle at NEW', () => {
    const targetCommit = commit('t', 4, 0);
    const newCommit = commit('n', 0, 0);
    const [path] = routeHistoryRelations(
      [targetCommit, newCommit],
      [revert(targetCommit, newCommit)],
      { annotationRows: new Map([['revert:one', 2]]) },
    );
    expect(path?.kind).toBe('revert');
    expect(path?.sourceNodeId).toBe(targetCommit.id);
    expect(path?.targetNodeId).toBe(newCommit.id);
    expect(path?.arrowD).toBe('');
    expect(path?.sourceMarkerD).toBeDefined();
    const mark = crossCenter(path!.sourceMarkerD!);
    const sourcePoint = pointForNode(targetCommit);
    const newPoint = pointForNode(newCommit);
    expect(Math.hypot(mark.x - sourcePoint.x, mark.y - sourcePoint.y)).toBeLessThan(
      Math.hypot(mark.x - newPoint.x, mark.y - newPoint.y),
    );
    expect(Math.hypot(lastSvgPoint(path!.d).x - newPoint.x, lastSvgPoint(path!.d).y - newPoint.y)).toBeGreaterThan(COMMIT_NODE_RADIUS);
  });

  it('keeps the cancel mark outside the TARGET disk and selection ring', () => {
    expect(HISTORY_RELATION_SELECTION_RING).toBe(NODE_SELECTION_RING_RADIUS);
    expect(historyRelationSourceCrossInset(commit('t', 4, 0))).toBe(
      NODE_SELECTION_RING_RADIUS + HISTORY_RELATION_CROSS_SIZE + HISTORY_RELATION_ARROW_GAP,
    );
    const targetCommit = commit('t', 6, 0);
    const newCommit = commit('n', 0, 0);
    const [path] = routeHistoryRelations([targetCommit, newCommit], [revert(targetCommit, newCommit)]);
    const mark = crossCenter(path!.sourceMarkerD!);
    const sourcePoint = pointForNode(targetCommit);
    const distance = Math.hypot(mark.x - sourcePoint.x, mark.y - sourcePoint.y);
    expect(distance).toBeGreaterThan(COMMIT_NODE_RADIUS + HISTORY_RELATION_CROSS_SIZE - 0.05);
    expect(distance).toBeGreaterThan(NODE_SELECTION_RING_RADIUS + 0.5);
    expect(distance - HISTORY_RELATION_CROSS_SIZE).toBeGreaterThan(COMMIT_NODE_RADIUS);
    const historical = { ...targetCommit, kind: 'reflog-commit' as const };
    expect(historyRelationSourceCrossInset(historical)).toBe(
      Math.max(SMALL_COMMIT_NODE_RADIUS, NODE_SELECTION_RING_RADIUS) + HISTORY_RELATION_CROSS_SIZE + HISTORY_RELATION_ARROW_GAP,
    );
  });

  it('nudges a long same-lane revert off the parent edge without changing node lanes', () => {
    const targetCommit = commit('t', 6, 0);
    const newCommit = commit('n', 0, 0);
    const nodes = [newCommit, targetCommit];
    const [path] = routeHistoryRelations(nodes, [revert(targetCommit, newCommit)], { annotationRows: new Map([['revert:one', 3]]) });
    const sourcePoint = pointForNode(targetCommit);
    const { start, c1 } = cubicControls(path!.d);
    expect(Math.abs(c1.x - start.x)).toBeCloseTo(HISTORY_RELATION_SAME_LANE_NUDGE, 5);
    expect(Math.abs(c1.x - sourcePoint.x)).toBeGreaterThan(10);
    expect(nodes.map((node) => node.lane)).toEqual([0, 0]);
    expect(nodes.map((node) => node.row)).toEqual([0, 6]);
  });

  it('does not add a same-lane bulge when the relation already leaves the column', () => {
    const targetCommit = commit('t', 6, 0);
    const newCommit = commit('n', 0, 2);
    const [path] = routeHistoryRelations([targetCommit, newCommit], [revert(targetCommit, newCommit)]);
    const sourcePoint = pointForNode(targetCommit);
    const newPoint = pointForNode(newCommit);
    const { c1 } = cubicControls(path!.d);
    const naturalLateral = Math.min(18, Math.abs(newPoint.x - sourcePoint.x) * 0.18);
    expect(Math.abs(c1.x - sourcePoint.x)).toBeLessThan(naturalLateral + 4);
    expect(Math.abs(c1.x - sourcePoint.x)).not.toBeCloseTo(HISTORY_RELATION_SAME_LANE_NUDGE, 0);
  });

  it('does not detour a short same-lane revert', () => {
    const targetCommit = commit('t', 1, 0);
    const newCommit = commit('n', 0, 0);
    const [path] = routeHistoryRelations([targetCommit, newCommit], [revert(targetCommit, newCommit)]);
    const numbers = svgPathNumbers(path!.d);
    expect(Math.abs(numbers[2] - numbers[0])).toBeLessThan(1);
  });

  it('keeps triangle arrowheads for Amend overlays', () => {
    const path = assertArrowClearsTarget(commit('o', 2, 1), commit('n', 0, 0), 1);
    expect(path.arrowD.startsWith('M ')).toBe(true);
    expect(path.sourceMarkerD).toBeUndefined();
  });

  it('keeps triangle arrowheads for Cherry-pick overlays', () => {
    const source = commit('s', 2, 1);
    const target = commit('c', 0, 0);
    const [path] = routeHistoryRelations([source, target], [cherryPick(source, target)]);
    expect(path?.arrowD.startsWith('M ')).toBe(true);
    expect(path?.sourceMarkerD).toBeUndefined();
    const tip = firstSvgPoint(path!.arrowD);
    const newPoint = pointForNode(target);
    expect(Math.hypot(tip.x - newPoint.x, tip.y - newPoint.y)).toBeGreaterThan(COMMIT_NODE_RADIUS);
  });
});
