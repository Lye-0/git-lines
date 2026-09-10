import { describe, expect, it } from 'vitest';
import type { GitCommit, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { GraphEdge, GraphNode } from '../../src/model/graphModel.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { DAG_NODE_CLEARANCE, pointForNode, routeEdges, routeHistoryRelations } from '../../src/layout/edgeRouter.js';
import { nodeMarkGeometry, nodeRingGeometry } from '../../src/layout/nodeGeometry.js';

const oid = (n: number) => n.toString(16).repeat(40);
function octopus(): RepositorySnapshot {
  // Same full DAG as 112: both old/new merges retain all four parents.
  const definitions: Array<[number, number[], number]> = [[7, [2, 3, 4, 5], 6], [2, [1], 5], [5, [1], 4], [4, [1], 3], [3, [1], 2], [1, [0], 1], [0, [], 0], [6, [2, 3, 4, 5], 6]];
  const commits: GitCommit[] = definitions.map(([n, parents, date]) => ({ oid: oid(n), parentOids: parents.map(oid), subject: String(n), authorName: 'Fixture', committerName: 'Fixture', authorDate: date, committerDate: date }));
  return {
    repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
    commits,
    refs: [['feature-a', 3], ['feature-b', 4], ['feature-c', 5], ['main', 7]].map(([name, n]) => ({ fullName: `refs/heads/${name}`, shortName: String(name), type: 'local', oid: oid(Number(n)) })),
    workingTrees: [{ worktreeId: 'wt', path: 'C:/repo', branch: 'main', headOid: oid(7), detached: false, clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }],
    historyEvents: [{ id: 'amend', type: 'amend', refName: 'refs/heads/main', fromOid: oid(6), toOid: oid(7), timestamp: 6, subject: 'commit (amend): merge' }],
    reflogs: [{ refName: 'HEAD', selector: 'HEAD@{0}', previousOid: oid(6), newOid: oid(7), subject: 'commit (amend): merge', timestamp: 6 }],
    operations: [], shallowBoundaryOids: [], visibleCommitCount: commits.length, hasMore: false,
  };
}

function points(d: string) {
  const n = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  expect(n).toHaveLength(8);
  return Array.from({ length: 2001 }, (_, i) => {
    const t = i / 2000, s = 1 - t;
    return { x: s ** 3 * n[0] + 3 * s * s * t * n[2] + 3 * s * t * t * n[4] + t ** 3 * n[6],
      y: s ** 3 * n[1] + 3 * s * s * t * n[3] + 3 * s * t * t * n[5] + t ** 3 * n[7] };
  });
}

function originalPath(a: GraphNode, b: GraphNode, rowHeight = 38) {
  const p = pointForNode(a, { rowHeight }), q = pointForNode(b, { rowHeight });
  const delta = Math.min(56, Math.max(8, Math.abs(q.y - p.y) * 0.28));
  return `M ${p.x} ${p.y} C ${p.x} ${p.y + delta}, ${q.x} ${q.y - delta}, ${q.x} ${q.y}`;
}

describe('DAG edges avoid unrelated commit geometry', () => {
  it.each([true, false])('preserves every octopus parent and avoids actual node/ring disks (reflog=%s)', (showReflog) => {
    const snapshot = octopus();
    const facts = buildGraphFacts(snapshot, { showReflog });
    const before = JSON.stringify(facts);
    const layout = createGraphLayout(facts, { visibleCommitCount: 8, hasMore: false, primaryBranch: 'main' });
    expect(JSON.stringify(facts)).toBe(before);
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    const expected = snapshot.commits.filter((c) => showReflog || c.oid !== oid(6)).flatMap((c) => c.parentOids.map((p) => [`commit:${c.oid}`, `commit:${p}`]));
    expect(layout.edges.filter((e) => e.type === 'parent').map((e) => [e.fromNodeId, e.toNodeId])).toEqual(expected);
    const parents = layout.edgePaths!.filter((p) => p.type === 'parent');
    expect(parents).toHaveLength(showReflog ? 13 : 9);
    for (const parent of parents) {
      const edge = layout.edges.find((e) => e.id === parent.id)!;
      const from = byId.get(edge.fromNodeId)!, to = byId.get(edge.toNodeId)!;
      const samples = points(parent.d);
      expect(samples[0]).toEqual(pointForNode(from));
      expect(samples.at(-1)).toEqual(pointForNode(to));
      for (let i = 1; i < samples.length; i++) expect(samples[i].y).toBeGreaterThanOrEqual(samples[i - 1].y);
      for (const node of layout.nodes.filter((n) => n.oid && n.id !== from.id && n.id !== to.id)) {
        const p = pointForNode(node), mark = nodeMarkGeometry(node), ring = nodeRingGeometry(node);
        const minimum = Math.min(...samples.map((q) => Math.hypot(q.x - p.x - mark.center.x, q.y - p.y - mark.center.y)));
        expect(minimum, `${from.oid} → ${to.oid} near ${node.oid}`).toBeGreaterThan(ring.r + DAG_NODE_CLEARANCE - 0.01);
      }
      const original = points(originalPath(from, to));
      // The detour remains below one lane of lateral change in this fixture.
      expect(Math.max(...samples.map((p, i) => Math.abs(p.x - original[i].x)))).toBeLessThanOrEqual(layout.laneWidth);
    }
    expect(layout.nodes.find((n) => n.oid === oid(5))).toMatchObject({ lane: 3, row: showReflog ? 5 : 3 });
    expect(layout.nodes.find((n) => n.oid === oid(4))).toMatchObject({ lane: 2, row: showReflog ? 6 : 4 });
    expect(layout.nodes.find((n) => n.oid === oid(3))).toMatchObject({ lane: 1, row: showReflog ? 7 : 5 });
    expect(layout.operationAnnotationRows).toHaveLength(showReflog ? 1 : 0);
    if (showReflog) {
      expect(layout.nodes.find((n) => n.oid === oid(6))).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
      expect(layout.historyRelations).toHaveLength(1);
      expect(layout.historyRelations![0]).toMatchObject({ kind: 'amend', sourceOid: oid(6), targetOid: oid(7) });
      expect(layout.historyRelationPaths).toEqual(routeHistoryRelations(layout.nodes, layout.historyRelations!, { annotationRows: new Map(layout.operationAnnotationRows!.map((r) => [r.relationId, r.row])) }));
    }
  });

  it('keeps noninterfering ordinary and two-parent paths byte-for-byte unchanged', () => {
    const nodes: GraphNode[] = [{ id: 'merge', kind: 'commit', lane: 0, row: 0, refIds: [] }, { id: 'left', kind: 'commit', lane: 0, row: 1, refIds: [] }, { id: 'right', kind: 'commit', lane: 1, row: 2, refIds: [] }];
    const edges: GraphEdge[] = ['left', 'right'].map((id) => ({ id, type: 'parent', fromNodeId: 'merge', toNodeId: id }));
    const paths = routeEdges(nodes, edges);
    expect(paths.map((p) => p.d)).toEqual(nodes.slice(1).map((n) => originalPath(nodes[0], n)));
  });

  it('uses final rows, custom spacing and linked-worktree geometry without mutating nodes', () => {
    const nodes: GraphNode[] = [{ id: 's', kind: 'reflog-commit', lane: 2, row: 2, refIds: [] }, { id: 'o', kind: 'commit', lane: 1, row: 5, refIds: [], linkedWorktrees: octopus().workingTrees }, { id: 't', kind: 'commit', lane: 0, row: 8, refIds: [] }];
    const before = JSON.stringify(nodes);
    const edge: GraphEdge = { id: 'edge', type: 'parent', fromNodeId: 's', toNodeId: 't' };
    const options = { rowHeight: 27, laneWidth: 40, leftPadding: 33 };
    const [path] = routeEdges(nodes, [edge], options);
    const obstacle = pointForNode(nodes[1], options);
    expect(Math.min(...points(path.d).map((p) => Math.hypot(p.x - obstacle.x, p.y - obstacle.y)))).toBeGreaterThan(nodeRingGeometry(nodes[1]).r + DAG_NODE_CLEARANCE);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(routeEdges(nodes, [edge], options)).toEqual([path]);
  });
});
