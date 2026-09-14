import { describe, expect, it } from 'vitest';
import { resolveDefaultBranch } from '../../src/model/defaultBranchResolver.js';
import { branchCommitOrigins } from '../../src/model/branchProtection.js';
import type { GitCommit, GitRef, ReflogEntry } from '../../src/git/gitTypes.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import type { GraphFactModel } from '../../src/model/graphModel.js';

const ref = (name: string, oid: string): GitRef => ({ fullName: `refs/heads/${name}`, shortName: name, type: 'local', oid });
const head = (remote: string, branch: string): GitRef => ({ fullName: `refs/remotes/${remote}/HEAD`, shortName: `${remote}/HEAD`, type: 'symbolic', targetRef: `refs/remotes/${remote}/${branch}` });
const commit = (oid: string, parents: string[]): GitCommit => ({ oid, parentOids: parents, subject: oid, authorName: 'A', committerName: 'A', authorDate: 1, committerDate: 1 });
const entry = (i: number, old: string, oid: string, subject: string, refName = 'HEAD'): ReflogEntry => ({ refName, selector: `HEAD@{${i}}`, previousOid: old, newOid: oid, subject, timestamp: 1 });

describe('default target resolution', () => {
  it('requires actual remote metadata and resolves origin before other remotes', () => {
    expect(resolveDefaultBranch([ref('main', 'a')])).toBeUndefined();
    expect(resolveDefaultBranch([ref('main', 'a'), ref('trunk', 'b'), head('origin', 'trunk'), head('upstream', 'main')])).toMatchObject({ refName: 'refs/heads/trunk', branch: 'trunk' });
  });
  it('handles ambiguity, remote-only and removed manual targets', () => {
    expect(resolveDefaultBranch([ref('main', 'a'), ref('trunk', 'b'), head('one', 'main'), head('two', 'trunk')])).toBeUndefined();
    const refs: GitRef[] = [head('origin', 'trunk'), { fullName: 'refs/remotes/origin/trunk', shortName: 'origin/trunk', type: 'remote', oid: 'a' }];
    expect(resolveDefaultBranch(refs)).toMatchObject({ refName: 'refs/remotes/origin/trunk', branch: 'trunk' });
    expect(resolveDefaultBranch(refs, 'refs/remotes/origin/trunk')?.branch).toBe('trunk');
    expect(resolveDefaultBranch(refs, 'refs/heads/gone')).toBeUndefined();
  });
});

describe('branch creation evidence', () => {
  it('uses contiguous HEAD checkout/commit records, not ref movement', () => {
    const commits = [commit('a', []), commit('b', ['a']), commit('c', ['b'])];
    const logs = [entry(2, 'a', 'a', 'checkout: moving from main to feature'), entry(1, 'a', 'b', 'commit: first'), entry(0, 'b', 'c', 'merge feature: Fast-forward', 'refs/heads/main')];
    expect(branchCommitOrigins(logs, commits)).toEqual(new Map([['b', 'refs/heads/feature']]));
    expect(branchCommitOrigins([logs[0], { ...logs[1], selector: 'HEAD@{0}' }], commits).size).toBe(0);
    expect(branchCommitOrigins([logs[0], { ...logs[1], previousOid: 'wrong' }], commits).size).toBe(0);
  });
  it('does not carry branch identity through rebase or detached revision checkout', () => {
    const commits = [commit('b', ['a'])];
    expect(branchCommitOrigins([entry(1, 'a', 'a', 'checkout: moving from main to main~1'), entry(0, 'a', 'b', 'commit: detached')], commits).size).toBe(0);
    expect(branchCommitOrigins([entry(2, 'a', 'a', 'checkout: moving from main to feature'), entry(1, 'a', 'a', 'rebase (start)'), entry(0, 'a', 'b', 'commit: unknown')], commits).size).toBe(0);
  });
});

describe('separate fixed placement', () => {
  it.each([28, 30, 38])('retains protected identity, edges and rows while moving a non-default primary off lane zero (%i)', (rowHeight) => {
    const commits = [commit('c', ['a']), commit('b', ['a']), commit('a', [])];
    const refs = [ref('main', 'c'), ref('feature', 'b')];
    const facts: GraphFactModel = { commits, refs, primaryBranch: 'feature', nodes: commits.map((c, i) => ({ id: c.oid, oid: c.oid, kind: 'commit', subject: c.subject, refIds: [], timestamp: 3 - i })), edges: commits.flatMap((c) => c.parentOids.map((p) => ({ id: `${c.oid}:${p}`, type: 'parent', fromNodeId: c.oid, toNodeId: p }))), events: [], workingTrees: [], operations: [], shallowBoundaryOids: [] };
    const options = { visibleCommitCount: 3, hasMore: false, rowHeight };
    const old = createGraphLayout(facts, options);
    const fixed = createGraphLayout(facts, { ...options, fixedDefault: { refName: 'refs/heads/main', branch: 'main', oid: 'c', source: 'manual' } });
    expect(fixed.nodes.find((n) => n.oid === 'c')!.lane).toBe(0);
    expect(fixed.nodes.find((n) => n.oid === 'b')!.lane).toBeGreaterThan(0);
    expect(fixed.nodes.map((n) => [n.id, n.row, n.trackId])).toEqual(old.nodes.map((n) => [n.id, n.row, n.trackId]));
    expect(fixed.edges).toEqual(old.edges);
    expect(fixed.tracks.map((t) => [t.id, t.color, t.refNames])).toEqual(old.tracks.map((t) => [t.id, t.color, t.refNames]));
    expect(createGraphLayout(facts, options)).toEqual(old);
  });
});
