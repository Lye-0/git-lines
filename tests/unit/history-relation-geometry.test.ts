import { describe, expect, it } from 'vitest';
import {
  COMMIT_NODE_RADIUS,
  HISTORY_RELATION_ARROW_GAP,
  HISTORY_RELATION_ARROW_SIZE,
  historyRelationTargetInset,
  pointForNode,
  routeHistoryRelations,
} from '../../src/layout/edgeRouter.js';
import type { GraphNode, HistoryRelation } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, row: number, lane: number): GraphNode {
  return { id: `commit:${letter}`, kind: 'commit', oid: oid(letter), refIds: [], row, lane, subject: letter };
}

function amend(source: GraphNode, target: GraphNode, id = 'amend:one'): HistoryRelation {
  return { id, kind: 'amend', sourceOid: source.oid!, targetOid: target.oid!, timestamp: 1, evidence: 'reflog' };
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
    expect(HISTORY_RELATION_ARROW_SIZE).toBe(3);
    expect(historyRelationTargetInset()).toBe(COMMIT_NODE_RADIUS + HISTORY_RELATION_ARROW_SIZE + HISTORY_RELATION_ARROW_GAP);
    expect(historyRelationTargetInset()).toBe(11.5);
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
