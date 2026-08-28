import { describe, expect, it } from 'vitest';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { RepositorySnapshot } from '../../src/git/gitTypes.js';

const oid = (letter: string) => letter.repeat(40);
const snapshot: RepositorySnapshot = {
  repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
  commits: [
    { oid: oid('b'), parentOids: [oid('a')], subject: 'B', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
    { oid: oid('a'), parentOids: [], subject: 'A', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
  ],
  refs: [
    { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') },
    { fullName: 'refs/tags/v1', shortName: 'v1', type: 'tag', oid: oid('b') },
  ],
  workingTrees: [{ worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('b'), branch: 'main', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
  operations: [], reflogs: [], historyEvents: [], shallowBoundaryOids: [], hasMore: false, visibleCommitCount: 2,
};

describe('graph fact builder', () => {
  it('deduplicates refs on one commit and keeps tag as metadata', () => {
    const facts = buildGraphFacts(snapshot);
    expect(facts.nodes.filter((node) => node.oid === oid('b') && node.kind === 'commit')).toHaveLength(1);
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.refIds).toEqual(['main', 'v1']);
    expect(facts.edges.some((edge) => edge.type === 'parent')).toBe(true);
  });

  it('always adds a Working Tree node even for a clean repository', () => {
    const working = buildGraphFacts(snapshot).nodes.find((node) => node.kind === 'working-tree');
    expect(working).toBeDefined();
    expect(working?.workingTree?.clean).toBe(true);
  });

  it('keeps a reachable commit normal even when it was loaded beyond the visible page', () => {
    const facts = buildGraphFacts({ ...snapshot, visibleCommitCount: 1 });
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.kind).toBe('commit');
  });

  it('materializes every octopus parent without collapsing unrelated roots', () => {
    const mergeSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('m'), parentOids: [oid('a'), oid('b'), oid('c')], subject: 'octopus', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        ...['a', 'b', 'c'].map((letter, index) => ({ oid: oid(letter), parentOids: [], subject: letter, authorName: 'A', authorDate: index, committerName: 'A', committerDate: index })),
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('m') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('m') }],
      visibleCommitCount: 4,
    };
    const facts = buildGraphFacts(mergeSnapshot);
    expect(facts.edges.filter((edge) => edge.type === 'parent' && edge.fromNodeId === `commit:${oid('m')}`)).toHaveLength(3);
  });

  it('preserves both parent edges of a real two-parent merge', () => {
    const mergeSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('m'), parentOids: [oid('b'), oid('c')], subject: 'merge', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'main', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('c'), parentOids: [oid('a')], subject: 'feature', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: oid('a'), parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('m') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('m'), branch: 'main' }],
      visibleCommitCount: 4,
    };
    const facts = buildGraphFacts(mergeSnapshot);
    expect(facts.edges.filter((edge) => edge.type === 'parent' && edge.fromNodeId === `commit:${oid('m')}`).map((edge) => edge.toNodeId)).toEqual([`commit:${oid('b')}`, `commit:${oid('c')}`]);
  });

  it('represents a ref move with one annotation edge instead of synthetic DAG edges', () => {
    const eventSnapshot: RepositorySnapshot = {
      ...snapshot,
      historyEvents: [{ id: 'history:reset:3:b', type: 'reset', refName: 'refs/heads/main', fromOid: oid('a'), toOid: oid('b'), timestamp: 3, subject: 'reset: moving to b' }],
    };
    const facts = buildGraphFacts(eventSnapshot);
    const eventEdges = facts.edges.filter((edge) => edge.type === 'history-event');
    expect(eventEdges).toHaveLength(1);
    expect(eventEdges[0]).toMatchObject({ annotation: 'ref-event', fromNodeId: `commit:${oid('b')}`, toNodeId: 'history:reset:3:b' });
  });

  it('keeps operation relationships separate from parent edges', () => {
    const operationSnapshot = { ...snapshot, operations: [{ type: 'cherry-pick' as const, headOid: oid('b'), sourceOids: [oid('a')] }] };
    const facts = buildGraphFacts(operationSnapshot);
    expect(facts.nodes.some((node) => node.kind === 'operation')).toBe(true);
    expect(facts.edges.some((edge) => edge.type === 'operation')).toBe(true);
    expect(facts.edges.filter((edge) => edge.type === 'parent')).toHaveLength(1);
  });

  it('keeps symbolic and pseudo refs out of ordinary commit badges', () => {
    const refs = [
      ...snapshot.refs,
      { fullName: 'refs/remotes/origin/HEAD', shortName: 'origin/HEAD', type: 'symbolic' as const, oid: oid('b'), targetRef: 'refs/remotes/origin/main' },
      { fullName: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote' as const, oid: oid('b') },
      { fullName: 'ORIG_HEAD', shortName: 'ORIG_HEAD', type: 'symbolic' as const, oid: oid('b') },
    ];
    const facts = buildGraphFacts({ ...snapshot, refs });
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.refIds).toEqual(['main', 'origin/main', 'v1']);
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.refBadges?.map((badge) => badge.name)).toEqual(['main', 'origin/main', 'v1']);
  });
});
