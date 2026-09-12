import { describe, expect, it } from 'vitest';
import { routeEdges, pointForNode, routeHistoryRelations, DAG_NODE_CLEARANCE } from '../../src/layout/edgeRouter.js';
import { nodeRingGeometry } from '../../src/layout/nodeGeometry.js';
import type { GraphNode, GraphEdge } from '../../src/model/graphModel.js';

function samples(path: string) {
  const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  let a = { x: values[0], y: values[1] };
  const points = [a];
  for (let offset = 2; offset < values.length; offset += 6) {
    const [x1, y1, x2, y2, x3, y3] = values.slice(offset, offset + 6);
    for (let i = 1; i <= 250; i++) {
      const t = i / 250, s = 1 - t;
      points.push({ x: s ** 3 * a.x + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t ** 3 * x3,
        y: s ** 3 * a.y + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t ** 3 * y3 });
    }
    a = { x: x3, y: y3 };
  }
  return points;
}
const node = (id: string, row: number, lane: number): GraphNode => ({ id, oid: id, kind: 'commit', row, lane, refIds: [] });
const edge = (from: string, to: string): GraphEdge => ({ id: `${from}:${to}`, type: 'parent', fromNodeId: from, toNodeId: to });

describe('bounded long parent routing', () => {
  it.each([28, 30, 38])('keeps the long historical route straight until its parent (rowHeight=%s)', (rowHeight) => {
    const nodes = [node('old', 0, 2), ...Array.from({ length: 40 }, (_, i) => node(`main${i}`, i + 1, 1))];
    nodes[0].kind = 'reflog-commit';
    const before = structuredClone(nodes);
    const options = { rowHeight };
    const [path] = routeEdges(nodes, [edge('old', 'main39')], options);
    const points = samples(path.d);
    const a = pointForNode(nodes[0], options), b = pointForNode(nodes.at(-1)!, options);
    expect(points[0]).toEqual(a);
    expect(points.at(-1)).toEqual(b);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(a.x);
    for (const point of points.filter((p) => p.y < b.y - rowHeight)) expect(point.x).toBeCloseTo(a.x);
    expect(nodes).toEqual(before);
  });

  it('preserves overlay geometry and short paths alongside a long edge', () => {
    const nodes = [node('a', 0, 0), node('b', 1, 1), node('c', 20, 2)];
    const relation = { id: 'amend', kind: 'amend' as const, sourceOid: 'b', targetOid: 'a', timestamp: 1, evidence: 'reflog' as const };
    const overlay = routeHistoryRelations(nodes, [relation]);
    const short = routeEdges(nodes, [edge('a', 'b')]);
    const all = routeEdges(nodes, [edge('a', 'b'), edge('b', 'c')]);
    expect(all[0]).toEqual(short[0]);
    expect(routeHistoryRelations(nodes, [relation])).toEqual(overlay);
  });

  it.each([30, 38])('preserves a spaced current/historical octopus and its shared base (rowHeight=%s)', (rowHeight) => {
    const nodes = [node('merge', 0, 0), { ...node('old', 1, 4), kind: 'reflog-commit' as const }, node('main', 2, 0), node('c', 5, 3), node('b', 9, 2), node('a', 13, 1), node('base', 24, 0)];
    const parents = ['main', 'a', 'b', 'c'];
    const edges = [...['merge', 'old'].flatMap((id) => parents.map((parent) => edge(id, parent))), ...parents.map((id) => edge(id, 'base'))];
    const before = JSON.stringify(nodes);
    const paths = routeEdges(nodes, edges, { rowHeight });
    expect(paths.map((path) => path.id)).toEqual(edges.map((edge) => edge.id));
    expect(paths).toHaveLength(12);
    for (const path of paths) {
      const fact = edges.find((edge) => edge.id === path.id)!;
      const points = samples(path.d);
      for (const obstacle of nodes.filter((node) => node.id !== fact.fromNodeId && node.id !== fact.toNodeId)) {
        const center = pointForNode(obstacle, { rowHeight });
        expect(Math.min(...points.map((point) => Math.hypot(point.x - center.x, point.y - center.y)))).toBeGreaterThan(nodeRingGeometry(obstacle).r + DAG_NODE_CLEARANCE - 0.01);
      }
    }
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it('falls back when every bounded corridor is blocked', () => {
    const nodes = [node('from', 0, 2), node('to', 20, 1), ...[92, 58, 109, 75, 41].map((x, i) => ({ ...node(`obstacle${i}`, 3 + i * 3, 0), visualX: x }))];
    const [path] = routeEdges(nodes, [edge('from', 'to')]);
    expect(path.d.match(/C/g)).toHaveLength(1);
    expect(samples(path.d)[0]).toEqual(pointForNode(nodes[0]));
    expect(samples(path.d).at(-1)).toEqual(pointForNode(nodes[1]));
  });

  it('checks generated multi-parent DAGs with irregular annotation-like gaps in all densities', () => {
    let seed = 8123;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    let routed = 0;
    for (let graph = 0; graph < 20; graph++) {
      const nodes = Array.from({ length: 24 }, (_, i) => ({ ...node(`n${i}`, i + Math.floor(i / 5), Math.floor(random() * 5)), kind: i % 4 === 0 ? 'reflog-commit' as const : 'commit' as const }));
      const edges = nodes.slice(0, -1).flatMap((from, i) => [...new Set(Array.from({ length: 3 }, () => i + 1 + Math.floor(random() * (23 - i))))].map((j) => edge(from.id, nodes[j].id)));
      const options = { rowHeight: [28, 30, 38][graph % 3] };
      const before = JSON.stringify({ nodes, edges });
      const paths = routeEdges(nodes, edges, options);
      expect(paths.map((path) => path.id)).toEqual(edges.map((edge) => edge.id));
      for (const path of paths) {
        const changed = (path.d.match(/C/g) ?? []).length === 3;
        if (changed) routed++;
        const fact = edges.find((edge) => edge.id === path.id)!;
        const from = nodes.find((node) => node.id === fact.fromNodeId)!, to = nodes.find((node) => node.id === fact.toNodeId)!;
        const points = samples(path.d);
        expect(points[0]).toEqual(pointForNode(from, options));
        expect(points.at(-1)).toEqual(pointForNode(to, options));
        for (let i = 1; i < points.length; i++) expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y - 1e-7);
        const extent = Math.max(pointForNode(from, options).x, pointForNode(to, options).x) + 17;
        if (changed) expect(Math.max(...points.map((p) => p.x))).toBeLessThanOrEqual(extent + 1e-7);
        for (const obstacle of nodes.filter((n) => n.id !== from.id && n.id !== to.id)) {
          const center = pointForNode(obstacle, options);
          const distance = Math.min(...points.map((p) => Math.hypot(p.x - center.x, p.y - center.y)));
          expect(distance).toBeGreaterThan(nodeRingGeometry(obstacle).r + DAG_NODE_CLEARANCE - 0.01);
        }
      }
      expect(JSON.stringify({ nodes, edges })).toBe(before);
    }
    expect(routed).toBeGreaterThan(100);
  });
});
