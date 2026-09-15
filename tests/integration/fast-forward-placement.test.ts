import { expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { pointForNode } from '../../src/layout/edgeRouter.js';
import { routeNameForNode } from '../../webview/src/components/routePresentation.js';

it.each([false, true])('protects FF source routes and connects FF annotations in both modes (Reflog %s)', async (showReflog) => {
  const f = createGitFixture();
  try {
    const commit = (subject: string) => { f.run(['commit', '--allow-empty', '-m', subject]); return f.run(['rev-parse', 'HEAD']).trim(); };
    commit('base');
    f.run(['switch', '-c', 'feature']);
    const first = commit('feature one'), second = commit('feature two');
    f.run(['switch', 'main']); f.run(['merge', '--ff-only', 'feature']);
    for (const phase of ['shared-tip', 'deleted', 'main-continues']) {
      if (phase === 'deleted') f.run(['branch', '-d', 'feature']);
      const mainCommit = phase === 'main-continues' ? commit('main resumes') : undefined;
      const client = new GitClient();
      const snapshot = await client.readSnapshot(f.root, 30, showReflog);
      const protectionReflogs = await client.readBranchProtection(snapshot);
      const facts = buildGraphFacts(snapshot, { showReflog });
      for (const fixed of [false, true]) for (const [rowHeight, laneWidth] of [[28, 22], [30, 34], [38, 34]]) {
        const options = { visibleCommitCount: 30, hasMore: false, rowHeight, laneWidth, protectionReflogs,
          fixedDefault: fixed ? { refName: 'refs/heads/main', branch: 'main', oid: mainCommit ?? second, source: 'manual' as const } : undefined };
        const layout = createGraphLayout(facts, options);
        const working = layout.nodes.find((n) => n.kind === 'working-tree')!;
        for (const oid of [first, second]) {
          const node = layout.nodes.find((n) => n.oid === oid && n.kind === 'commit')!;
          expect(node.lane).not.toBe(working.lane);
          expect(routeNameForNode(node, layout.tracks)).toBe('feature');
        }
        if (mainCommit) expect(layout.nodes.find((n) => n.oid === mainCommit && n.kind === 'commit')!.lane).toBe(working.lane);
        expect(layout.edges).toEqual(facts.edges);
        const baseline = createGraphLayout(facts, { visibleCommitCount: 30, hasMore: false, rowHeight, laneWidth });
        expect(layout.nodes.map((n) => [n.id, n.row])).toEqual(baseline.nodes.map((n) => [n.id, n.row]));
        const ffEdges = layout.edges.filter((e) => e.annotation === 'ref-event' && [e.fromNodeId, e.toNodeId].some((id) => layout.nodes.find((n) => n.id === id)?.kind === 'fast-forward-event'));
        if (showReflog) expect(ffEdges.length).toBeGreaterThan(0);
        for (const edge of ffEdges) {
          const a = pointForNode(layout.nodes.find((n) => n.id === edge.fromNodeId)!, options);
          const b = pointForNode(layout.nodes.find((n) => n.id === edge.toNodeId)!, options);
          if (phase !== 'main-continues') {
            // Proven branch intake stays on the receiver lane, and the checkout
            // reaches its real target through that existing FF junction.
            expect(layout.edgePaths!.some((p) => p.id === edge.id)).toBe(false);
            const checkout = layout.edges.find((e) => e.type === 'working-tree' && e.toNodeId === edge.fromNodeId)!;
            expect(layout.edgePaths!.filter((p) => p.id === checkout.id)).toHaveLength(1);
            const w = pointForNode(working, options);
            expect(b.x).toBeCloseTo(w.x, 5);
            expect(layout.branchIntegrationPaths?.filter(p => p.eventId === edge.toNodeId)).toHaveLength(2);
            expect(b.y).toBeCloseTo((w.y + a.y) / 2, 5);
            continue;
          }
          expect(layout.edgePaths!.some((p) => p.id === edge.id)).toBe(false);
          const parent = layout.edges.find((e) => e.type === 'parent' && e.toNodeId === edge.fromNodeId && layout.nodes.find((n) => n.id === e.fromNodeId)?.oid === mainCommit)!;
          expect(layout.edgePaths!.filter((p) => p.id === parent.id)).toHaveLength(1);
          const child = pointForNode(layout.nodes.find((n) => n.id === parent.fromNodeId)!, options);
          expect(b.x).toBeCloseTo(child.x, 5);
          expect(layout.branchIntegrationPaths?.filter(p => p.eventId === edge.toNodeId)).toHaveLength(2);
          expect(b.y).toBeCloseTo((child.y + a.y) / 2, 5);
        }
        // Cached placement must retain the same source ownership on refresh.
        const again = createGraphLayout(facts, { ...options, previousNodeLanes: new Map(layout.nodes.map((n) => [n.id, n.lane!])), previousLanes: new Map(layout.tracks.map((t) => [t.id, t.lane])) });
        for (const oid of [first, second]) expect(routeNameForNode(again.nodes.find((n) => n.oid === oid && n.kind === 'commit'), again.tracks)).toBe('feature');
      }
      // A ref move alone, without creation evidence, must not invent ownership.
      const noOrigins = protectionReflogs.filter((entry) => !entry.subject.startsWith('commit'));
      expect(createGraphLayout(facts, { visibleCommitCount: 30, hasMore: false, protectionReflogs: noOrigins }))
        .toEqual(createGraphLayout(facts, { visibleCommitCount: 30, hasMore: false }));
    }
  } finally { f.dispose(); }
}, 20000);
