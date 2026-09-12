import { describe, expect, it } from 'vitest';
import {
  rebaseGroupBounds,
  routeRebaseRelations,
  pointForNode,
} from '../../src/layout/edgeRouter.js';
import { insertOperationAnnotationRows } from '../../src/layout/operationRows.js';
import type { GraphNode, RebaseRelation } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, row: number, lane: number, kind: GraphNode['kind'] = 'commit'): GraphNode {
  return { id: `commit:${letter}`, kind, oid: oid(letter), refIds: [], row, lane, subject: letter };
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

function relation(oldLetters: string[], newLetters: string[]): RebaseRelation {
  const oldOids = oldLetters.map(oid);
  const newOids = newLetters.map(oid);
  return {
    id: 'history:rebase:1',
    kind: 'rebase',
    refName: 'refs/heads/feature',
    oldOids,
    newOids,
    oldTipOid: oldOids.at(-1)!,
    newTipOid: newOids.at(-1)!,
    ontoOid: oid('m'),
    timestamp: 1,
    evidence: 'reflog',
  };
}

describe('completed rebase overlay geometry', () => {
  it('RB2 uses single relation mode without group outlines when each side has one commit', () => {
    const oldNode = commit('f', 4, 1, 'reflog-commit');
    const newNode = commit('f2', 1, 0);
    const overlay = routeRebaseRelations([oldNode, newNode], [relation(['f'], ['f2'])]);
    expect(overlay.outlines).toEqual([]);
    expect(overlay.paths).toHaveLength(1);
    expect(overlay.paths[0]).toMatchObject({ kind: 'rebase', sourceNodeId: oldNode.id, targetNodeId: newNode.id });
  });

  it('RB20 points the single-commit arrow along OLD → NEW, not the reverse chord', () => {
    const oldNode = commit('f', 4, 1, 'reflog-commit');
    const newNode = commit('f2', 1, 0);
    const [path] = routeRebaseRelations([oldNode, newNode], [relation(['f'], ['f2'])]).paths;
    const oldPoint = pointForNode(oldNode);
    const newPoint = pointForNode(newNode);
    const tip = firstSvgPoint(path.arrowD);
    const vertices = arrowVertices(path.arrowD);
    const base = { x: (vertices[1].x + vertices[2].x) / 2, y: (vertices[1].y + vertices[2].y) / 2 };
    const alongArrow = { x: tip.x - base.x, y: tip.y - base.y };
    const towardNew = { x: newPoint.x - oldPoint.x, y: newPoint.y - oldPoint.y };
    expect(alongArrow.x * towardNew.x + alongArrow.y * towardNew.y).toBeGreaterThan(0);
    expect(Math.hypot(tip.x - newPoint.x, tip.y - newPoint.y)).toBeLessThan(Math.hypot(tip.x - oldPoint.x, tip.y - oldPoint.y));
  });

  it('RB21 / RB22 outline only group members and connect OLD GROUP → NEW GROUP boundaries', () => {
    const nodes = [
      commit('c2', 0, 0),
      commit('b2', 1, 0),
      commit('a2', 2, 0),
      commit('m', 3, 0),
      commit('c', 5, 1, 'reflog-commit'),
      commit('b', 6, 1, 'reflog-commit'),
      commit('a', 7, 1, 'reflog-commit'),
      commit('i', 8, 0),
      commit('x', 6, 2, 'reflog-commit'),
    ];
    const overlay = routeRebaseRelations(nodes, [relation(['a', 'b', 'c'], ['a2', 'b2', 'c2'])]);
    expect(overlay.outlines).toHaveLength(2);
    expect(overlay.paths).toHaveLength(1);
    const oldBounds = rebaseGroupBounds(nodes, [oid('a'), oid('b'), oid('c')])!;
    const newBounds = rebaseGroupBounds(nodes, [oid('a2'), oid('b2'), oid('c2')])!;
    const initial = pointForNode(nodes.find((node) => node.oid === oid('i'))!);
    const onto = pointForNode(nodes.find((node) => node.oid === oid('m'))!);
    const amendSource = pointForNode(nodes.find((node) => node.oid === oid('x'))!);
    expect(initial.x < oldBounds.minX || initial.x > oldBounds.maxX || initial.y < oldBounds.minY || initial.y > oldBounds.maxY).toBe(true);
    expect(onto.x < newBounds.minX || onto.x > newBounds.maxX || onto.y < newBounds.minY || onto.y > newBounds.maxY).toBe(true);
    expect(amendSource.x < oldBounds.minX || amendSource.x > oldBounds.maxX || amendSource.y < oldBounds.minY || amendSource.y > oldBounds.maxY).toBe(true);

    const start = firstSvgPoint(overlay.paths[0]!.d);
    const end = lastSvgPoint(overlay.paths[0]!.d);
    const oldCenter = { x: (oldBounds.minX + oldBounds.maxX) / 2, y: (oldBounds.minY + oldBounds.maxY) / 2 };
    const newCenter = { x: (newBounds.minX + newBounds.maxX) / 2, y: (newBounds.minY + newBounds.maxY) / 2 };
    const onRect = (point: { x: number; y: number }, bounds: typeof oldBounds) => {
      const epsilon = 0.5;
      const onVertical = (Math.abs(point.x - bounds.minX) < epsilon || Math.abs(point.x - bounds.maxX) < epsilon)
        && point.y >= bounds.minY - epsilon && point.y <= bounds.maxY + epsilon;
      const onHorizontal = (Math.abs(point.y - bounds.minY) < epsilon || Math.abs(point.y - bounds.maxY) < epsilon)
        && point.x >= bounds.minX - epsilon && point.x <= bounds.maxX + epsilon;
      return onVertical || onHorizontal;
    };
    expect(onRect(start, oldBounds)).toBe(true);
    expect(Math.hypot(end.x - newCenter.x, end.y - newCenter.y)).toBeLessThan(Math.hypot(start.x - newCenter.x, start.y - newCenter.y));
    expect(Math.hypot(start.x - oldCenter.x, start.y - oldCenter.y)).toBeLessThan(Math.hypot(end.x - oldCenter.x, end.y - oldCenter.y));

    const tip = firstSvgPoint(overlay.paths[0]!.arrowD);
    const vertices = arrowVertices(overlay.paths[0]!.arrowD);
    const base = { x: (vertices[1].x + vertices[2].x) / 2, y: (vertices[1].y + vertices[2].y) / 2 };
    const alongArrow = { x: tip.x - base.x, y: tip.y - base.y };
    const towardNew = { x: (newBounds.minX + newBounds.maxX) / 2 - (oldBounds.minX + oldBounds.maxX) / 2, y: (newBounds.minY + newBounds.maxY) / 2 - (oldBounds.minY + oldBounds.maxY) / 2 };
    expect(alongArrow.x * towardNew.x + alongArrow.y * towardNew.y).toBeGreaterThan(0);
  });

  it('does not draw a partial group overlay when a member node is missing', () => {
    const nodes = [
      commit('c2', 0, 0),
      commit('b2', 1, 0),
      commit('a2', 2, 0),
      commit('c', 5, 1, 'reflog-commit'),
      commit('b', 6, 1, 'reflog-commit'),
    ];
    const overlay = routeRebaseRelations(nodes, [relation(['a', 'b', 'c'], ['a2', 'b2', 'c2'])]);
    expect(overlay.paths).toEqual([]);
    expect(overlay.outlines).toEqual([]);
  });

  it('RA1–RA5 align the multi marker with the annotation row between the groups', () => {
    const laidOut = insertOperationAnnotationRows(
      [
        commit('3', 0, 0),
        commit('2', 1, 0),
        commit('1', 2, 0),
        commit('9', 3, 0),
        commit('e', 4, 1, 'reflog-commit'),
        commit('d', 5, 1, 'reflog-commit'),
        commit('c', 6, 1, 'reflog-commit'),
      ],
      [relation(['c', 'd', 'e'], ['1', '2', '3'])],
    );
    const annotationRow = laidOut.rows[0]!;
    const rowHeight = 38;
    const overlay = routeRebaseRelations(laidOut.nodes, [relation(['c', 'd', 'e'], ['1', '2', '3'])], {
      rowHeight,
      annotationRows: new Map([[annotationRow.relationId, annotationRow.row]]),
    });
    const path = overlay.paths[0]!;
    const markerY = 18 + annotationRow.row * rowHeight;
    expect(path.labelY).toBe(markerY);
    const start = firstSvgPoint(path.d);
    const end = lastSvgPoint(path.d);
    expect(Math.min(start.y, end.y)).toBeLessThan(path.labelY);
    expect(Math.max(start.y, end.y)).toBeGreaterThan(path.labelY);
    expect(path.labelX).toBeGreaterThan(Math.min(start.x, end.x) - 0.5);
    expect(path.labelX).toBeLessThan(Math.max(start.x, end.x) + 0.5);

    const newRows = ['1', '2', '3'].map((id) => laidOut.nodes.find((node) => node.oid === oid(id))!.row!);
    const oldRows = ['c', 'd', 'e'].map((id) => laidOut.nodes.find((node) => node.oid === oid(id))!.row!);
    expect(annotationRow.row).toBeGreaterThan(Math.max(...newRows));
    expect(annotationRow.row).toBeLessThan(Math.min(...oldRows));
    expect(laidOut.nodes.find((node) => node.oid === oid('1'))!.row).toBeLessThan(laidOut.nodes.find((node) => node.oid === oid('9'))!.row!);
  });

  it('RA7 keeps a single rebase marker on the same annotation Y contract', () => {
    const oldNode = commit('f', 4, 1, 'reflog-commit');
    const newNode = commit('4', 1, 0);
    const laidOut = insertOperationAnnotationRows([newNode, oldNode], [relation(['f'], ['4'])]);
    const annotationRow = laidOut.rows[0]!;
    const shiftedOld = laidOut.nodes.find((node) => node.oid === oid('f'))!;
    const shiftedNew = laidOut.nodes.find((node) => node.oid === oid('4'))!;
    const overlay = routeRebaseRelations([shiftedOld, shiftedNew], [relation(['f'], ['4'])], {
      annotationRows: new Map([[annotationRow.relationId, annotationRow.row]]),
    });
    expect(overlay.outlines).toEqual([]);
    expect(overlay.paths[0]?.labelY).toBeCloseTo(18 + annotationRow.row * 38, 5);
    expect(annotationRow.row).toBeGreaterThan(shiftedNew.row!);
    expect(annotationRow.row).toBeLessThan(shiftedOld.row!);
  });
});
