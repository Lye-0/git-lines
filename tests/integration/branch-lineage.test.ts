import { expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { resolveDefaultBranch } from '../../src/model/defaultBranchResolver.js';
import { branchLineage } from '../../src/model/branchLineage.js';
import { routeNameForNode } from '../../webview/src/components/routePresentation.js';

async function verify(root: string, owners: Array<[string, string]>, pairs: Array<[string, string]>, workingBranch: string) {
  for (const showReflog of [false, true]) {
    const client = new GitClient(), snapshot = await client.readSnapshot(root, 100, showReflog);
    const protectionReflogs = await client.readBranchProtection(snapshot), facts = buildGraphFacts(snapshot, { showReflog });
    const local = snapshot.refs.find((r) => r.fullName === 'refs/heads/main');
    const target = resolveDefaultBranch(snapshot.refs) ?? (local ? { refName: local.fullName, branch: 'main', oid: local.oid!, source: 'manual' as const } : undefined);
    for (const fixed of [false, true]) for (const [rowHeight, laneWidth] of [[28, 22], [30, 34], [38, 34]]) {
      const options = { visibleCommitCount: 100, hasMore: false, rowHeight, laneWidth, protectionReflogs, fixedDefault: fixed ? target : undefined };
      const layout = createGraphLayout(facts, options);
      const find = (oid: string) => layout.nodes.find((n) => n.kind === 'commit' && n.oid === oid)!;
      for (const [oid, branch] of owners) expect(routeNameForNode(find(oid), layout.tracks)?.replace(/^origin\//, '')).toBe(branch);
      for (const [parent, child] of pairs) expect(find(parent).lane!).toBeLessThan(find(child).lane!);
      const working = layout.nodes.find((n) => n.kind === 'working-tree')!;
      expect(routeNameForNode(working, layout.tracks)).toBe(workingBranch);
      for (const [oid, branch] of owners) if (branch !== workingBranch) expect(find(oid).lane).not.toBe(working.lane);
      expect(layout.edges).toEqual(facts.edges);
      const refresh = createGraphLayout(facts, { ...options, previousRows: new Map(layout.nodes.map((n) => [n.id, n.row!])), previousLanes: new Map(layout.tracks.map((t) => [t.id, t.lane])), previousNodeLanes: new Map(layout.nodes.map((n) => [n.id, n.lane!])) });
      expect(refresh.nodes.map((n) => [n.id, n.row, n.lane, n.trackId])).toEqual(layout.nodes.map((n) => [n.id, n.row, n.lane, n.trackId]));
    }
  }
}

it('keeps a non-default source left through nested checkout, commits and child-into-source merge', async () => {
  const f = createGitFixture();
  try {
    const commit = (s: string) => { f.run(['commit', '--allow-empty', '-m', s]); return f.run(['rev-parse', 'HEAD']).trim(); };
    const base = commit('base'); f.run(['switch', '-c', 'z-parent']); const p1 = commit('P1'); f.run(['switch', '-c', 'a-child']);
    await verify(f.root, [[base, 'main'], [p1, 'z-parent']], [], 'a-child');
    const c1 = commit('C1');
    await verify(f.root, [[base, 'main'], [p1, 'z-parent'], [c1, 'a-child']], [[p1, c1]], 'a-child');
    f.run(['switch', 'z-parent']); const p2 = commit('P2'); f.run(['merge', '--no-ff', 'a-child', '-m', 'child into parent']); const pm = f.run(['rev-parse', 'HEAD']).trim();
    await verify(f.root, [[p1, 'z-parent'], [p2, 'z-parent'], [c1, 'a-child'], [pm, 'z-parent']], [[pm, c1]], 'z-parent');
  } finally { f.dispose(); }
}, 20000);

it('preserves merge ownership when main is merged into feature and then fast-forwards', async () => {
  const f = createGitFixture();
  try {
    const commit = (s: string) => { f.run(['commit', '--allow-empty', '-m', s]); return f.run(['rev-parse', 'HEAD']).trim(); };
    const base = commit('base'); f.run(['switch', '-c', 'feature']); const feature = commit('feature'); f.run(['switch', 'main']); const main = commit('main');
    f.run(['switch', 'feature']); f.run(['merge', '--no-ff', 'main', '-m', 'main into feature']); const merge = f.run(['rev-parse', 'HEAD']).trim();
    await verify(f.root, [[base, 'main'], [main, 'main'], [feature, 'feature'], [merge, 'feature']], [], 'feature');
    f.run(['switch', 'main']); f.run(['merge', '--ff-only', 'feature']);
    await verify(f.root, [[base, 'main'], [main, 'main'], [feature, 'feature'], [merge, 'feature']], [], 'main');
  } finally { f.dispose(); }
}, 20000);

it('keeps the remote default and shared base left when its local ref is absent', async () => {
  const f = createGitFixture();
  try {
    const commit = (s: string) => { f.run(['commit', '--allow-empty', '-m', s]); return f.run(['rev-parse', 'HEAD']).trim(); };
    const base = commit('base'); f.run(['switch', '-c', 'feature']); const child = commit('child'); f.run(['switch', 'main']); const parent = commit('parent');
    f.run(['update-ref', 'refs/remotes/origin/main', parent]); f.run(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    f.run(['switch', 'feature']); f.run(['branch', '-D', 'main']);
    await verify(f.root, [[base, 'main'], [parent, 'main'], [child, 'feature']], [[base, child], [parent, child]], 'feature');
  } finally { f.dispose(); }
}, 15000);

it('does not guess between indistinguishable branch-creation contexts', async () => {
  const fixtures = [createGitFixture(), createGitFixture()];
  try {
    const snapshots = [];
    for (const [i, f] of fixtures.entries()) {
      const run = (args: string[]) => f.run(args, { ...process.env, GIT_AUTHOR_DATE: '2026-09-14T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-14T00:00:00Z' });
      run(['commit', '--allow-empty', '-m', 'base']); run(['branch', 'sibling']);
      if (i === 0) run(['branch', 'child', 'HEAD']);
      run(['switch', 'sibling']);
      if (i === 1) run(['branch', 'child', 'HEAD']);
      run(['switch', 'child']);
      snapshots.push(await new GitClient().readSnapshot(f.root, 100, true));
    }
    expect(snapshots[0].refs).toEqual(snapshots[1].refs);
    expect(snapshots[0].reflogs).toEqual(snapshots[1].reflogs);
    for (const snapshot of snapshots) expect(branchLineage(snapshot.reflogs).some((r) => r.child === 'child')).toBe(false);
  } finally { for (const f of fixtures) f.dispose(); }
}, 15000);
