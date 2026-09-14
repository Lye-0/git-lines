import { describe, expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { branchCommitOrigins } from '../../src/model/branchProtection.js';
import path from 'node:path';

describe('default fixed branch independence with real Git', () => {
  it('uses a separate linked-worktree HEAD log after the source branch is deleted', async () => {
    const f = createGitFixture();
    try {
      f.run(['commit', '--allow-empty', '-m', 'base']);
      const linked = path.join(f.root, 'linked');
      f.run(['worktree', 'add', '-b', 'feature', linked]);
      f.run(['-C', linked, 'commit', '--allow-empty', '-m', 'feature']);
      const source = f.run(['-C', linked, 'rev-parse', 'HEAD']).trim();
      f.run(['merge', '--ff-only', 'feature']);
      f.run(['-C', linked, 'switch', '--detach']); f.run(['branch', '-d', 'feature']);
      const client = new GitClient(), snapshot = await client.readSnapshot(f.root, 30, false);
      const logs = await client.readBranchProtection(snapshot);
      expect(branchCommitOrigins(logs, snapshot.commits).get(source)).toBe('refs/heads/feature');
      const fixed = createGraphLayout(buildGraphFacts(snapshot, { showReflog: false }), { visibleCommitCount: 30, hasMore: false,
        fixedDefault: { refName: 'refs/heads/main', branch: 'main', oid: source, source: 'manual' }, protectionReflogs: logs });
      expect(fixed.nodes.find((n) => n.oid === source && n.kind === 'commit')!.lane).toBeGreaterThan(0);
    } finally { f.dispose(); }
  }, 15000);
  it.each(['into-main', 'into-feature'])('preserves actual merge direction: %s', async (direction) => {
    const f = createGitFixture();
    try {
      f.run(['commit', '--allow-empty', '-m', 'base']);
      f.run(['switch', '-c', 'feature']); f.run(['commit', '--allow-empty', '-m', 'feature']);
      const feature = f.run(['rev-parse', 'HEAD']).trim();
      f.run(['switch', 'main']); f.run(['commit', '--allow-empty', '-m', 'main']);
      if (direction === 'into-feature') f.run(['switch', 'feature']);
      f.run(['merge', '--no-ff', direction === 'into-main' ? 'feature' : 'main', '-m', 'merge']);
      const merged = f.run(['rev-parse', 'HEAD']).trim();
      const snapshot = await new GitClient().readSnapshot(f.root, 30, true);
      const facts = buildGraphFacts(snapshot, { showReflog: true });
      const options = { visibleCommitCount: 30, hasMore: false };
      const fixed = createGraphLayout(facts, { ...options, fixedDefault: { refName: 'refs/heads/main', branch: 'main', oid: snapshot.refs.find((r) => r.fullName === 'refs/heads/main')!.oid!, source: 'manual' }, protectionReflogs: snapshot.reflogs });
      expect(fixed.nodes.find((n) => n.oid === feature && n.kind === 'commit')!.lane).toBeGreaterThan(0);
      const mergeNode = fixed.nodes.find((n) => n.oid === merged && n.kind === 'commit')!;
      if (direction === 'into-main') expect(mergeNode.lane).toBe(0);
      else expect(mergeNode.lane).toBeGreaterThan(0);
      expect(fixed.edges).toEqual(createGraphLayout(facts, options).edges);
      expect(fixed.edges.filter((e) => e.fromNodeId === mergeNode.id && e.type === 'parent')).toHaveLength(2);
    } finally { f.dispose(); }
  }, 15000);
  it('preserves feature columns before commits, after FF, after deletion and after main continues', async () => {
    const f = createGitFixture();
    try {
      const commit = (message: string) => { f.run(['commit', '--allow-empty', '-m', message]); return f.run(['rev-parse', 'HEAD']).trim(); };
      const root = commit('base');
      f.run(['switch', '-c', 'feature']);
      const client = new GitClient();
      const read = async () => {
        const snapshot = await client.readSnapshot(f.root, 30, true);
        return [false, true].flatMap((showReflog) => [28, 30, 38].map((rowHeight) => {
          const facts = buildGraphFacts(snapshot, { showReflog });
          const legacy = createGraphLayout(facts, { visibleCommitCount: 30, hasMore: false, rowHeight });
          const fixed = createGraphLayout(facts, { visibleCommitCount: 30, hasMore: false, rowHeight,
            fixedDefault: { refName: 'refs/heads/main', branch: 'main', oid: snapshot.refs.find((r) => r.fullName === 'refs/heads/main')!.oid!, source: 'manual' }, protectionReflogs: snapshot.reflogs });
          expect(fixed.edges).toEqual(legacy.edges);
          expect(fixed.operationAnnotationRows).toEqual(legacy.operationAnnotationRows);
          expect(fixed.nodes.map((n) => [n.id, n.row])).toEqual(legacy.nodes.map((n) => [n.id, n.row]));
          return { fixed, snapshot };
        }));
      };
      for (const { fixed } of await read()) {
        expect(fixed.nodes.find((n) => n.kind === 'working-tree')!.lane).toBeGreaterThan(0);
        expect(fixed.nodes.filter((n) => n.kind === 'commit' && n.oid === root)).toHaveLength(1);
      }
      const first = commit('feature one'), second = commit('feature two');
      f.run(['switch', 'main']); f.run(['merge', '--ff-only', 'feature']);
      for (const deleted of [false, true]) {
        if (deleted) f.run(['branch', '-d', 'feature']);
        for (const { fixed, snapshot } of await read()) {
          expect(branchCommitOrigins(snapshot.reflogs, snapshot.commits).get(first)).toBe('refs/heads/feature');
          for (const oid of [first, second]) {
            const node = fixed.nodes.find((n) => n.kind === 'commit' && n.oid === oid)!;
            expect(node.lane).toBeGreaterThan(0);
            expect(fixed.tracks.find((t) => t.id === node.trackId)!.family).toBe('feature');
          }
          expect(fixed.nodes.find((n) => n.kind === 'working-tree')!.lane).toBe(0);
          expect(fixed.nodes.find((n) => n.oid === second && n.kind === 'commit')!.refIds).toContain('main');
        }
      }
      const main = commit('main continues');
      for (const { fixed } of await read()) {
        expect(fixed.nodes.find((n) => n.oid === main && n.kind === 'commit')!.lane).toBe(0);
        expect(fixed.nodes.find((n) => n.oid === second)!.lane).toBeGreaterThan(0);
      }
    } finally { f.dispose(); }
  }, 20000);
});
