import { expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { routeNameForNode } from '../../webview/src/components/routePresentation.js';
import { branchCommitOrigins } from '../../src/model/branchProtection.js';
import { sharedTipRouteContinuity } from '../../src/model/sharedTipRouteContinuity.js';

it('keeps a commit-tree criss-cross route intact after main only moves its ref', async () => {
  const f = createGitFixture();
  try {
    const commit = (name: string) => { f.run(['commit', '--allow-empty', '-m', name]); return f.run(['rev-parse', 'HEAD']).trim(); };
    const root = commit('root');
    f.run(['switch', '-c', 'feature-a']); const a1 = commit('A1');
    f.run(['switch', 'main']); f.run(['switch', '-c', 'feature-b']); const b1 = commit('B1');
    const tree = f.run(['rev-parse', 'HEAD^{tree}']).trim();
    const m1 = f.run(['commit-tree', tree, '-p', a1, '-p', b1, '-m', 'M1']).trim();
    const m2 = f.run(['commit-tree', tree, '-p', b1, '-p', a1, '-m', 'M2']).trim();
    const a2 = f.run(['commit-tree', tree, '-p', m1, '-m', 'A2']).trim();
    const b2 = f.run(['commit-tree', tree, '-p', m2, '-m', 'B2']).trim();
    f.run(['update-ref', 'refs/heads/feature-a', a2]); f.run(['update-ref', 'refs/heads/feature-b', b2]);
    f.run(['update-ref', 'refs/heads/main', a2]); f.run(['switch', 'main']);
    for (const fixed of [false, true]) for (const showReflog of [false, true]) {
      const reader = new GitClient();
      let previous: ReturnType<typeof createGraphLayout> | undefined;
      for (const limit of [2, 4, 8, 16]) {
        const page = await reader.readSnapshot(f.root, limit, showReflog);
        const before = page.commits.map((c) => c.oid);
        const logs = await reader.readBranchProtection(page);
        const evidence = await reader.readRouteContinuityEvidence(page, logs);
        expect(page.commits.map((c) => c.oid)).toEqual(before);
        expect(evidence.length - page.commits.length).toBeLessThanOrEqual(64);
        const layout = createGraphLayout(buildGraphFacts(page, { showReflog }), { visibleCommitCount: page.visibleCommitCount, hasMore: page.hasMore,
          protectionReflogs: logs, routeEvidenceCommits: evidence,
          fixedDefault: fixed ? { refName: 'refs/heads/main', branch: 'main', oid: a2, source: 'manual' } : undefined,
          previousRows: previous && new Map(previous.nodes.map((n) => [n.id, n.row!])),
          previousLanes: previous && new Map(previous.tracks.map((t) => [t.id, t.lane])),
          previousNodeLanes: previous && new Map(previous.nodes.map((n) => [n.id, n.lane!])),
        });
        expect(routeNameForNode(layout.nodes.find((n) => n.kind === 'commit' && n.oid === a2), layout.tracks)).toBe('feature-a');
        expect(layout.nodes.filter((n) => n.kind === 'commit').length).toBeLessThanOrEqual(limit);
        for (const node of previous?.nodes.filter((n) => n.kind === 'commit') ?? []) {
          const current = layout.nodes.find((n) => n.id === node.id)!;
          expect([current.lane, current.row, current.trackId]).toEqual([node.lane, node.row, node.trackId]);
        }
        previous = layout;
      }
    }
    const client = new GitClient();
    for (const showReflog of [false, true]) {
      const snapshot = await client.readSnapshot(f.root, 100, showReflog);
      const logs = await client.readBranchProtection(snapshot);
      const facts = buildGraphFacts(snapshot, { showReflog });
      expect(sharedTipRouteContinuity(snapshot.commits, snapshot.refs, logs).get(a2)).toBe('refs/heads/feature-a');
      expect(branchCommitOrigins(logs, snapshot.commits).has(m1)).toBe(false);
      expect(branchCommitOrigins(logs, snapshot.commits).has(a2)).toBe(false);
      for (const fixed of [false, true]) for (const [rowHeight, laneWidth] of [[28, 22], [30, 34], [38, 34]]) {
        const options = { visibleCommitCount: 100, hasMore: false, rowHeight, laneWidth, protectionReflogs: logs,
          fixedDefault: fixed ? { refName: 'refs/heads/main', branch: 'main', oid: a2, source: 'manual' as const } : undefined };
        const layout = createGraphLayout(facts, options);
        const find = (oid: string) => layout.nodes.find((n) => n.kind === 'commit' && n.oid === oid)!;
        for (const oid of [a1, m1, a2]) {
          expect(routeNameForNode(find(oid), layout.tracks), `${find(oid)?.subject}, fixed=${fixed}, reflog=${showReflog}`).toBe('feature-a');
          expect(find(oid).lane).toBe(find(a1).lane);
          expect(find(oid).lane).toBeGreaterThan(0);
        }
        for (const oid of [b1, m2, b2]) expect(routeNameForNode(find(oid), layout.tracks)).toBe('feature-b');
        expect(routeNameForNode(find(root), layout.tracks)).toBe('main');
        expect(find(root).lane).toBe(0);
        expect(find(a2).refIds).toContain('main');
        expect(find(a2).refIds).toContain('feature-a');
        const working = layout.nodes.find((n) => n.kind === 'working-tree')!;
        expect(working.lane).toBe(0);
        expect(layout.edges.some((e) => e.type === 'working-tree' && e.fromNodeId === working.id && e.toNodeId === find(a2).id)).toBe(true);
        expect(layout.edges).toEqual(facts.edges);
        expect(layout.edges.filter((e) => e.type === 'parent')).toHaveLength(8);
        expect(layout.edges.some((e) => e.type === 'parent' && e.fromNodeId === find(m1).id && e.toNodeId === find(root).id)).toBe(false);
        const again = createGraphLayout(facts, { ...options, previousRows: new Map(layout.nodes.map((n) => [n.id, n.row!])), previousLanes: new Map(layout.tracks.map((t) => [t.id, t.lane])), previousNodeLanes: new Map(layout.nodes.map((n) => [n.id, n.lane!])) });
        expect(again.nodes.map((n) => [n.id, n.row, n.lane, n.trackId])).toEqual(layout.nodes.map((n) => [n.id, n.row, n.lane, n.trackId]));
      }
    }
  } finally { f.dispose(); }
}, 20000);
