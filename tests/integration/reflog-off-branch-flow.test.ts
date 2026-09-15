import { expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createGitFixture } from '../fixtures/gitFixture.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
// Compile the real component with production JSX semantics without adding DOM
// globals/JSX to the extension-host TypeScript configuration.
const bundled = buildSync({ entryPoints: ['webview/src/components/GraphViewport.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] }).outputFiles[0].text;
const componentModule = { exports: {} as { GraphViewport: React.ComponentType<any> } };
new Function('require', 'module', 'exports', bundled)(createRequire(path.join(process.cwd(), 'package.json')), componentModule, componentModule.exports);
const { GraphViewport } = componentModule.exports;

it.each([false, true])('loads OFF cold, toggles without stale rows/marks, and invalidates expired evidence (fixed=%s)', async fixed => {
  const f = createGitFixture();
  try {
    f.run(['commit', '--allow-empty', '-m', 'base']);
    f.run(['switch', '-c', 'feature']);
    f.run(['commit', '--allow-empty', '-m', 'one']); f.run(['commit', '--allow-empty', '-m', 'two']);
    f.run(['switch', 'main']); f.run(['merge', '--ff-only', 'feature']); f.run(['branch', '-d', 'feature']);
    f.run(['commit', '--allow-empty', '-m', 'main later']);
    const client = new GitClient();
    const read = async (showReflog: boolean) => {
      const snapshot = await client.readSnapshot(f.root, 100, showReflog);
      const logs = await client.readBranchProtection(snapshot);
      const facts = buildGraphFacts(snapshot, { showReflog, branchEvidence: logs });
      const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore,
        protectionReflogs: logs, rowHeight: 30,
        fixedDefault: fixed ? { refName: 'refs/heads/main', branch: 'main', oid: snapshot.refs.find(r => r.fullName === 'refs/heads/main')!.oid!, source: 'manual' } : undefined });
      expect(layout.edges).toEqual(facts.edges);
      return { snapshot, layout };
    };
    const cold = await read(false); // no ON read or shared warm reader beforehand
    expect(cold.snapshot.reflogs).toEqual([]);
    expect(cold.snapshot.historyEvents).toEqual([]);
    expect(cold.layout.branchIntegrationPaths).toHaveLength(2);
    const html = renderToStaticMarkup(React.createElement(GraphViewport, { layout: cold.layout, filter: '', loading: false,
      onSelect: () => {}, onSelectWorkingTree: () => {}, onSelectEvent: () => {}, onLoadMore: () => {} }));
    expect(html).toContain('data-branch-flow="intake"');
    expect(html).not.toMatch(/node-fast-forward-event|FF ·|Fast-forward branch intake|Receiving branch continuation|operation-annotation-row/);
    expect(cold.layout.nodes.every(n => !n.event)).toBe(true);
    expect(cold.layout.operationAnnotationRows).toEqual([]);
    expect(cold.layout.nodes.flatMap(n => n.refBadges ?? []).some(b => b.fullName === 'refs/heads/feature')).toBe(false);
    const on = await read(true), off = await read(false), onAgain = await read(true);
    expect(off.layout).toEqual(cold.layout);
    expect(onAgain.layout).toEqual(on.layout);
    expect(on.layout.nodes.filter(n => n.kind === 'fast-forward-event')).toHaveLength(1);
    expect(cold.layout.nodes).toHaveLength(on.layout.nodes.length - 1);
    const expected = cold.layout.nodes.filter(n => n.commit).map(n => [n.oid, n.commit!.parentOids, n.refBadges]);
    expect(on.layout.nodes.filter(n => n.commit).map(n => [n.oid, n.commit!.parentOids, n.refBadges])).toEqual(expected);
    const onHtml = renderToStaticMarkup(React.createElement(GraphViewport, { layout: on.layout, filter: '', loading: false,
      onSelect: () => {}, onSelectWorkingTree: () => {}, onSelectEvent: () => {}, onLoadMore: () => {} }));
    expect(onHtml).toContain('node-fast-forward-event');
    expect(onHtml).toContain('FF ·');
    // Expire only the disposable test repo, then reuse the same reader.
    f.run(['reflog', 'expire', '--expire=now', '--all']);
    const expired = await read(false);
    expect(expired.layout.branchIntegrationPaths).toEqual([]);
    expect(expired.snapshot.commits.map(c => [c.oid, c.parentOids])).toEqual(cold.snapshot.commits.map(c => [c.oid, c.parentOids]));
    const partial = buildGraphFacts({ ...on.snapshot, commits: on.snapshot.commits.filter(c => c.oid !== on.layout.branchIntegrations![0].beforeOid) },
      { showReflog: false, branchEvidence: on.snapshot.reflogs });
    expect(partial.branchIntegrations).toEqual([]);
  } finally { f.dispose(); }
}, 20000);
