import { expect, it } from 'vitest';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { pointForNode } from '../../src/layout/edgeRouter.js';
import { branchIntegrations } from '../../src/model/branchIntegration.js';
import { routeNameForNode } from '../../webview/src/components/routePresentation.js';

it.each([1, 3].flatMap(count => [false, true].flatMap(deleted => [false, true].map(advance => ({ count, deleted, advance })))))
('connects the receiver through an FF junction ($count commits, deleted=$deleted, advance=$advance)', async ({ count, deleted, advance }) => {
  const f = createGitFixture();
  try {
    const commit = (name: string) => { f.run(['commit', '--allow-empty', '-m', name]); return f.run(['rev-parse', 'HEAD']).trim(); };
    f.run(['branch', '-m', 'release']);
    const base = commit('base');
    f.run(['switch', '-c', 'topic/a']);
    const imported = Array.from({ length: count }, (_, i) => commit(`change ${i}`));
    const tip = imported.at(-1)!;
    f.run(['switch', 'release']); f.run(['merge', '--ff-only', 'topic/a']);
    if (deleted) f.run(['branch', '-d', 'topic/a']);
    if (advance) commit('receiver advances');
    const client = new GitClient();
    const snapshot = await client.readSnapshot(f.root, 100, true);
    const logs = await client.readBranchProtection(snapshot);
    for (const fixed of [false, true]) for (const showReflog of [true, false]) {
      const facts = buildGraphFacts(snapshot, { showReflog });
      const parents = facts.edges.filter(e => e.type === 'parent');
      const expectedParents = snapshot.commits.flatMap(c => c.parentOids.map(p => `parent:${c.oid}:${p}`)).sort();
      expect(parents.map(e => e.id).sort()).toEqual(expectedParents);
      for (const [rowHeight, laneWidth] of [[30, 34], [38, 34], [28, 22]]) {
        const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: false,
          protectionReflogs: logs, rowHeight, laneWidth,
          fixedDefault: fixed ? { refName: 'refs/heads/release', branch: 'release', oid: snapshot.refs.find(r => r.fullName === 'refs/heads/release')!.oid!, source: 'manual' } : undefined });
        expect(layout.edges).toEqual(facts.edges);
        expect(layout.nodes.filter(n => n.commit).map(n => n.oid).sort()).toEqual(snapshot.commits.map(c => c.oid).sort());
        for (const c of snapshot.commits) expect(layout.nodes.find(n => n.commit?.oid === c.oid)!.commit!.parentOids).toEqual(c.parentOids);
        for (const oid of imported) expect(routeNameForNode(layout.nodes.find(n => n.kind === 'commit' && n.oid === oid), layout.tracks)).toBe('topic/a');
        const tipNode = layout.nodes.find(n => n.kind === 'commit' && n.oid === tip)!;
        expect(tipNode.refBadges?.some(r => r.fullName === 'refs/heads/topic/a') ?? false).toBe(!deleted);
        expect(layout.branchIntegrationPaths).toHaveLength(showReflog ? 2 : 0);
        if (!showReflog) continue;
        const event = layout.nodes.find(n => n.kind === 'fast-forward-event')!;
        const baseNode = layout.nodes.find(n => n.kind === 'commit' && n.oid === base)!;
        expect(event.lane).toBe(baseNode.lane);
        expect(tipNode.lane).not.toBe(event.lane);
        expect(event.visualX).toBeUndefined();
        expect(layout.branchIntegrations).toEqual([expect.objectContaining({ sourceRef: 'refs/heads/topic/a', targetRef: 'refs/heads/release', beforeOid: base, tipOid: tip })]);
        const flow = layout.branchIntegrationPaths!;
        expect(flow.find(p => p.role === 'continuation')).toMatchObject({ fromNodeId: event.id, toNodeId: baseNode.id });
        expect(flow.find(p => p.role === 'intake')).toMatchObject({ fromNodeId: event.id, toNodeId: tipNode.id });
        const connector = layout.edges.find(e => e.toNodeId === tipNode.id && e.type === (advance ? 'parent' : 'working-tree'))!;
        const rendered = layout.edgePaths!.find(p => p.edgeId === connector.id)!;
        expect(rendered.toNodeId).toBe(tipNode.id);
        const junction = pointForNode(event, { rowHeight, laneWidth });
        const numbers = rendered.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        // First cubic terminates on the existing event, not a fabricated commit.
        expect(numbers.slice(6, 8)).toEqual([junction.x, junction.y]);
        expect(layout.edgePaths!.filter(p => p.edgeId === connector.id)).toHaveLength(1);
      }
    }
    const events = snapshot.historyEvents;
    expect(branchIntegrations(events, snapshot.commits, [])).toEqual([]);
    // Missing imported object cannot fabricate an intake, even with an FF label.
    expect(branchIntegrations(events, snapshot.commits.filter(c => c.oid !== tip), logs)).toEqual([]);
    const noOperation = logs.filter(l => !/Fast-forward/.test(l.subject));
    expect(branchIntegrations(events, snapshot.commits, noOperation)).toEqual([]);
    expect(branchIntegrations(events, snapshot.commits, logs.filter(l => !/^commit/.test(l.subject)))).toEqual([]);
    expect(branchIntegrations(events, snapshot.commits, [...logs, {
      refName: 'refs/heads/conflicting', newOid: tip, subject: 'commit: conflicting evidence', selector: 'refs/heads/conflicting@{0}', timestamp: 0,
    }])).toEqual([]);
    expect(branchIntegrations(events.map(e => ({ ...e, rawReflogMessage: 'pull: Fast-forward' })), snapshot.commits, logs)).toEqual([]);
  } finally { f.dispose(); }
});

it('does not force a non-default receiver into the leftmost Standard lane', async () => {
  const f = createGitFixture();
  try {
    f.run(['commit', '--allow-empty', '-m', 'root']);
    const root = f.run(['rev-parse', 'HEAD']).trim();
    f.run(['switch', '-c', 'release']); f.run(['commit', '--allow-empty', '-m', 'release base']);
    f.run(['switch', '-c', 'topic']); f.run(['commit', '--allow-empty', '-m', 'topic commit']);
    f.run(['switch', 'release']); f.run(['merge', '--ff-only', 'topic']);
    const client = new GitClient(), snapshot = await client.readSnapshot(f.root, 100, true);
    const facts = buildGraphFacts(snapshot, { showReflog: true }), logs = await client.readBranchProtection(snapshot);
    for (const fixed of [false, true]) {
      const layout = createGraphLayout(facts, { visibleCommitCount: 100, hasMore: false, protectionReflogs: logs,
        fixedDefault: fixed ? { refName: 'refs/heads/main', branch: 'main', oid: root, source: 'manual' } : undefined });
      expect(layout.nodes.find(n => n.kind === 'fast-forward-event')!.lane).toBeGreaterThan(0);
      expect(layout.branchIntegrationPaths).toHaveLength(2);
      expect(layout.nodes.find(n => n.kind === 'commit' && n.oid === root)!.lane).toBe(0);
    }
  } finally { f.dispose(); }
});

it('does not call a shared-tip ref move an intake or remove existing branch independence', async () => {
  const f = createGitFixture();
  try {
    f.run(['commit', '--allow-empty', '-m', 'base']);
    f.run(['switch', '-c', 'topic']); f.run(['commit', '--allow-empty', '-m', 'child']);
    const tip = f.run(['rev-parse', 'HEAD']).trim();
    f.run(['update-ref', 'refs/heads/main', tip]); f.run(['switch', 'main']);
    const client = new GitClient(), snapshot = await client.readSnapshot(f.root, 100, true);
    const logs = await client.readBranchProtection(snapshot);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    expect(facts.branchIntegrations).toEqual([]);
    const layout = createGraphLayout(facts, { visibleCommitCount: 100, hasMore: false, protectionReflogs: logs });
    expect(layout.branchIntegrationPaths).toEqual([]);
    expect(routeNameForNode(layout.nodes.find(n => n.kind === 'commit' && n.oid === tip), layout.tracks)).toBe('topic');
  } finally { f.dispose(); }
});
