import { describe, expect, it } from 'vitest';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { RepositorySnapshot } from '../../src/git/gitTypes.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';

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
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.headState).toBe('attached');
    expect(facts.edges.some((edge) => edge.type === 'parent')).toBe(true);
  });

  it('always adds a Working Tree node even for a clean repository', () => {
    const working = buildGraphFacts(snapshot).nodes.find((node) => node.kind === 'working-tree');
    expect(working).toBeDefined();
    expect(working?.workingTree?.clean).toBe(true);
  });

  it('connects Working Tree to the checked-out HEAD instead of a remote-ahead tip', () => {
    const remoteAheadSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('c'), parentOids: [oid('b')], subject: 'remote C', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'remote B', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('a'), parentOids: [oid('i')], subject: 'local A', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
        { oid: oid('i'), parentOids: [], subject: 'initial', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
      ],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('i') },
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('a') },
        { fullName: 'refs/remotes/origin/feature', shortName: 'origin/feature', type: 'remote', oid: oid('c') },
      ],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a'), branch: 'feature' }],
      visibleCommitCount: 4,
    };
    const facts = buildGraphFacts(remoteAheadSnapshot);
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    const workingEdge = facts.edges.find((edge) => edge.type === 'working-tree');
    expect(working?.oid).toBe(oid('a'));
    expect(workingEdge?.toNodeId).toBe(`commit:${oid('a')}`);
    expect(workingEdge?.toNodeId).not.toBe(`commit:${oid('c')}`);
  });

  it('keeps a detached HEAD at an existing commit live without creating a branch ref', () => {
    const detachedSnapshot: RepositorySnapshot = {
      ...snapshot,
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a'), branch: undefined, detached: true }],
    };

    const facts = buildGraphFacts(detachedSnapshot, { showReflog: false });
    const head = facts.nodes.find((node) => node.oid === oid('a'));

    expect(detachedSnapshot.workingTrees[0]).toMatchObject({ detached: true, headOid: oid('a') });
    expect(head).toMatchObject({ kind: 'commit', previousRoute: false, historicalKind: undefined, headState: 'detached' });
    expect(head?.refBadges).toEqual([]);
  });

  it('treats a newly-created detached HEAD commit as a live DAG root', () => {
    const detachedOid = oid('d');
    const detachedSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: detachedOid, parentOids: [oid('a')], subject: 'detached commit', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'Main commit two', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('a'), parentOids: [], subject: 'Main commit one', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: detachedOid, branch: undefined, detached: true }],
      reflogs: [],
      visibleCommitCount: 3,
    };

    const facts = buildGraphFacts(detachedSnapshot, { showReflog: false });
    const head = facts.nodes.find((node) => node.oid === detachedOid);
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    const layout = createGraphLayout(facts, {
      visibleCommitCount: detachedSnapshot.visibleCommitCount,
      hasMore: detachedSnapshot.hasMore,
      primaryBranch: facts.primaryBranch,
    });

    expect(head).toMatchObject({ kind: 'commit', previousRoute: false, historicalKind: undefined, refBadges: [], headState: 'detached' });
    expect(working?.workingTree).toMatchObject({ detached: true, headOid: detachedOid });
    expect(facts.edges).toContainEqual(expect.objectContaining({
      type: 'working-tree',
      fromNodeId: working?.id,
      toNodeId: `commit:${detachedOid}`,
    }));
    expect(layout.nodes.find((node) => node.oid === detachedOid)?.trackId).not.toBe('family:main');
    expect(layout.tracks.find((track) => track.id === layout.nodes.find((node) => node.oid === detachedOid)?.trackId)?.family).not.toBe('historical');
  });

  it('promotes a detached commit to UNREFERENCED only after HEAD leaves it', () => {
    const detachedOid = oid('d');
    const leftDetachedSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: detachedOid, parentOids: [oid('a')], subject: 'detached commit', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'Main commit two', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('a'), parentOids: [], subject: 'Main commit one', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('b'), branch: 'main', detached: false }],
      reflogs: [{ refName: 'HEAD', newOid: detachedOid, selector: 'HEAD@{1}', timestamp: 4, subject: 'commit: detached commit' }],
      visibleCommitCount: 3,
    };

    const facts = buildGraphFacts(leftDetachedSnapshot, { showReflog: true });
    const detached = facts.nodes.find((node) => node.oid === detachedOid);
    const main = facts.nodes.find((node) => node.oid === oid('b'));

    expect(detached).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: true });
    expect(detached?.headState).toBeUndefined();
    expect(main?.headState).toBe('attached');
  });

  it('attaches linked worktrees to their commit row without adding a second graph node', () => {
    const linkedSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('c'), parentOids: [oid('b')], subject: 'feature commit', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        ...snapshot.commits,
      ],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') },
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('c') },
      ],
      workingTrees: [
        { ...snapshot.workingTrees[0], currentWorktree: true, mainWorktree: true },
        { ...snapshot.workingTrees[0], worktreeId: 'worktree-1', path: 'C:/linked', headOid: oid('c'), branch: 'feature', currentWorktree: false, mainWorktree: false },
      ],
      visibleCommitCount: 3,
    };

    const facts = buildGraphFacts(linkedSnapshot);
    const feature = facts.nodes.find((node) => node.oid === oid('c'));

    expect(facts.nodes.filter((node) => node.kind === 'working-tree')).toHaveLength(1);
    expect(facts.nodes.find((node) => node.id === 'working:worktree-1')).toBeUndefined();
    expect(feature?.linkedWorktrees).toEqual([expect.objectContaining({
      worktreeId: 'worktree-1',
      branch: 'feature',
      path: 'C:/linked',
      headOid: oid('c'),
    })]);
    expect(facts.edges.filter((edge) => edge.type === 'working-tree')).toHaveLength(1);
  });

  it('uses the opened linked worktree as the single current Working Tree when it is not first', () => {
    const linkedSnapshot: RepositorySnapshot = {
      ...snapshot,
      repository: { ...snapshot.repository, root: 'C:/linked' },
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') }],
      workingTrees: [
        { ...snapshot.workingTrees[0], worktreeId: 'worktree-0', path: 'C:/repo', headOid: oid('b'), branch: 'main', currentWorktree: false, mainWorktree: true },
        { ...snapshot.workingTrees[0], worktreeId: 'worktree-1', path: 'C:/linked', headOid: oid('b'), branch: 'main', currentWorktree: true, mainWorktree: false },
      ],
    };

    const facts = buildGraphFacts(linkedSnapshot);
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    const commit = facts.nodes.find((node) => node.oid === oid('b'));

    expect(working?.id).toBe('working:worktree-1');
    expect(working?.workingTree?.path).toBe('C:/linked');
    expect(commit?.linkedWorktrees).toEqual([expect.objectContaining({ path: 'C:/repo', currentWorktree: false })]);
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

  it('represents a meaningful reset with one annotation edge instead of synthetic DAG edges', () => {
    const eventSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        ...snapshot.commits,
        { oid: oid('o'), parentOids: [oid('a')], subject: 'old unreachable tip', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      ],
      historyEvents: [{ id: 'history:reset:3:b', type: 'reset', refName: 'refs/heads/main', fromOid: oid('o'), toOid: oid('b'), timestamp: 3, subject: 'reset: moving to b' }],
    };
    const facts = buildGraphFacts(eventSnapshot);
    const eventEdges = facts.edges.filter((edge) => edge.type === 'history-event');
    expect(eventEdges).toHaveLength(1);
    expect(eventEdges[0]).toMatchObject({ annotation: 'ref-event', fromNodeId: `commit:${oid('b')}`, toNodeId: 'history:reset:3:b' });
    expect(facts.nodes.find((node) => node.id === 'history:reset:3:b')).toMatchObject({
      anchorCommitId: `commit:${oid('b')}`,
      targetRef: 'refs/heads/main',
    });
  });

  it('keeps multiple ref events as separate timeline facts on one destination', () => {
    const facts = buildGraphFacts({
      ...snapshot,
      commits: [
        ...snapshot.commits,
        { oid: oid('o'), parentOids: [oid('a')], subject: 'old unreachable tip', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      ],
      historyEvents: [
        { id: 'history:reset:3:b', type: 'reset', refName: 'refs/heads/main', fromOid: oid('o'), toOid: oid('b'), timestamp: 3, subject: 'reset: moving to b' },
        { id: 'history:amend:4:b', type: 'amend', refName: 'refs/heads/main', fromOid: oid('o'), toOid: oid('b'), timestamp: 4, subject: 'amend: moving to b' },
      ],
    });
    const eventNodes = facts.nodes.filter((node) => node.kind === 'history-event');
    expect(eventNodes).toHaveLength(2);
    expect(eventNodes.every((node) => node.anchorCommitId === `commit:${oid('b')}`)).toBe(true);
    expect(eventNodes.every((node) => node.targetRef === 'refs/heads/main')).toBe(true);
    expect(eventNodes.every((node) => node.oid === undefined)).toBe(true);
  });

  it('keeps a live ref-only reset event without turning it into a historical route', () => {
    const facts = buildGraphFacts({
      ...snapshot,
      historyEvents: [
        { id: 'history:reset:3:b', type: 'reset', refName: 'refs/heads/main', fromOid: oid('a'), toOid: oid('b'), timestamp: 3, subject: 'reset: moving to b' },
        { id: 'history:amend:4:b', type: 'amend', refName: 'refs/heads/main', fromOid: oid('a'), toOid: oid('b'), timestamp: 4, subject: 'commit (amend): B' },
      ],
    });

    expect(facts.events).toHaveLength(1);
    expect(facts.events[0]).toMatchObject({ type: 'reset', fromOid: oid('a'), toOid: oid('b') });
    expect(facts.nodes.filter((node) => node.kind === 'history-event')).toHaveLength(1);
    expect(facts.nodes.find((node) => node.event?.type === 'reset')).toMatchObject({ refOnly: true, historicalEvent: false });
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.previousRoute).toBe(false);
  });

  it('marks only the unreachable part of a reset path as PREVIOUS and hides it with Reflog off', () => {
    const facts = buildGraphFacts({
      ...snapshot,
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a') }],
      commits: [
        ...snapshot.commits,
        { oid: oid('x'), parentOids: [oid('y')], subject: 'old x', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('y'), parentOids: [oid('a')], subject: 'old y', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      ],
      historyEvents: [{ id: 'history:reset:5:a', type: 'reset', refName: 'refs/heads/main', fromOid: oid('x'), toOid: oid('a'), timestamp: 5, subject: 'reset --hard HEAD~2' }],
      visibleCommitCount: 2,
    });
    expect(facts.nodes.find((node) => node.oid === oid('x'))?.previousRoute).toBe(true);
    expect(facts.nodes.find((node) => node.oid === oid('y'))?.previousRoute).toBe(true);
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.previousRoute).toBe(false);
    expect(facts.events).toHaveLength(1);

    const hidden = buildGraphFacts({
      ...snapshot,
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a') }],
      commits: [
        ...snapshot.commits,
        { oid: oid('x'), parentOids: [oid('y')], subject: 'old x', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('y'), parentOids: [oid('a')], subject: 'old y', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      ],
      historyEvents: [{ id: 'history:reset:5:a', type: 'reset', refName: 'refs/heads/main', fromOid: oid('x'), toOid: oid('a'), timestamp: 5, subject: 'reset --hard HEAD~2' }],
      visibleCommitCount: 2,
    }, { showReflog: false });
    expect(hidden.events).toEqual([]);
    expect(hidden.nodes.some((node) => node.oid === oid('x'))).toBe(false);
  });

  it('does not relabel generic ref-move history as a reset/amend previous route', () => {
    const facts = buildGraphFacts({
      ...snapshot,
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a') }],
      historyEvents: [{ id: 'history:branch-move:3:a', type: 'branch-move', refName: 'refs/heads/main', fromOid: oid('b'), toOid: oid('a'), timestamp: 3, subject: 'branch: moving to a' }],
    });
    const oldNode = facts.nodes.find((node) => node.oid === oid('b'));

    expect(oldNode?.kind).toBe('reflog-commit');
    expect(oldNode?.previousRoute).toBe(false);
  });

  it('keeps reflog-retained commits from a removed ref on an UNREFERENCED historical route', () => {
    const historicalSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('c'), parentOids: [oid('b')], subject: 'Deleted branch C', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'Deleted branch B', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('a'), parentOids: [], subject: 'Shared main base', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a'), branch: 'main' }],
      reflogs: [
        { refName: 'HEAD', newOid: oid('c'), selector: 'HEAD@{0}', timestamp: 4, subject: 'commit: Deleted branch C' },
        { refName: 'HEAD', newOid: oid('b'), selector: 'HEAD@{1}', timestamp: 3, subject: 'commit: Deleted branch B' },
        { refName: 'HEAD', newOid: oid('a'), selector: 'HEAD@{2}', timestamp: 2, subject: 'checkout: moving from feature to main' },
      ],
      visibleCommitCount: 3,
    };
    const facts = buildGraphFacts(historicalSnapshot, { showReflog: true });
    const tip = facts.nodes.find((node) => node.oid === oid('c'));
    const branchCommit = facts.nodes.find((node) => node.oid === oid('b'));
    const shared = facts.nodes.find((node) => node.oid === oid('a'));

    expect(tip).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: true });
    expect(branchCommit).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: false });
    expect(branchCommit?.historicalRouteId).toBe(tip?.historicalRouteId);
    expect(shared).toMatchObject({ kind: 'commit', historicalKind: undefined });

    const hidden = buildGraphFacts(historicalSnapshot, { showReflog: false });
    expect(hidden.nodes.some((node) => node.oid === oid('c') || node.oid === oid('b'))).toBe(false);
  });

  it('uses DELETED BRANCH only when a reflog explicitly records the deletion', () => {
    const deletedSnapshot: RepositorySnapshot = {
      ...snapshot,
      commits: [
        { oid: oid('c'), parentOids: [oid('b')], subject: 'C', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        { oid: oid('b'), parentOids: [oid('a')], subject: 'B', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
        { oid: oid('a'), parentOids: [], subject: 'A', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      ],
      refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('a') }],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('a'), branch: 'main' }],
      reflogs: [
        { refName: 'HEAD', newOid: oid('a'), selector: 'HEAD@{0}', timestamp: 5, subject: 'branch: deleted feature' },
        { refName: 'HEAD', newOid: oid('a'), selector: 'HEAD@{1}', timestamp: 4, subject: 'checkout: moving from feature to main' },
        { refName: 'HEAD', newOid: oid('c'), selector: 'HEAD@{2}', timestamp: 3, subject: 'commit: C' },
        { refName: 'HEAD', newOid: oid('b'), selector: 'HEAD@{3}', timestamp: 2, subject: 'commit: B' },
      ],
      visibleCommitCount: 3,
    };
    const facts = buildGraphFacts(deletedSnapshot, { showReflog: true });
    expect(facts.nodes.find((node) => node.oid === oid('c'))).toMatchObject({ historicalKind: 'deleted-branch', historicalRouteHead: true });
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.historicalKind).toBe('deleted-branch');
  });

  it('marks the old tip of a completed rebase as PREVIOUS without graying the new route', () => {
    const facts = buildGraphFacts({
      ...snapshot,
      commits: [
        { oid: oid('n'), parentOids: [oid('b')], subject: 'rebased feature', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 },
        ...snapshot.commits,
        { oid: oid('o'), parentOids: [oid('a')], subject: 'old feature', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      ],
      refs: [
        { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('b') },
        { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('n') },
      ],
      workingTrees: [{ ...snapshot.workingTrees[0], headOid: oid('n'), branch: 'feature' }],
      historyEvents: [{ id: 'history:rebase:5:n', type: 'rebase', refName: 'refs/heads/feature', fromOid: oid('o'), toOid: oid('n'), boundaryOid: oid('b'), eventStartOid: oid('n'), timestamp: 5, subject: 'rebase (finish): refs/heads/feature onto ' + oid('b') }],
      visibleCommitCount: 4,
    });
    const oldNode = facts.nodes.find((node) => node.oid === oid('o'));
    const newNode = facts.nodes.find((node) => node.oid === oid('n'));
    const eventNode = facts.nodes.find((node) => node.id === 'history:rebase:5:n');

    expect(oldNode).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
    expect(newNode).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(eventNode).toMatchObject({
      kind: 'history-event',
      historicalEvent: false,
      anchorCommitId: `commit:${oid('n')}`,
      eventBoundaryCommitId: `commit:${oid('b')}`,
      eventStartCommitId: `commit:${oid('n')}`,
    });
  });

  it('keeps a completed operation destination separate from its semantic row boundary', () => {
    const newCommit = { oid: oid('n'), parentOids: [oid('b')], subject: 'new cherry-pick', authorName: 'A', authorDate: 4, committerName: 'A', committerDate: 4 };
    const facts = buildGraphFacts({
      ...snapshot,
      commits: [newCommit, ...snapshot.commits],
      historyEvents: [{
        id: 'history:cherry-pick:5:n',
        type: 'cherry-pick',
        refName: 'refs/heads/main',
        fromOid: oid('b'),
        toOid: oid('n'),
        boundaryOid: oid('b'),
        eventStartOid: oid('n'),
        timestamp: 5,
        subject: 'cherry-pick: source change',
      }],
    });
    const eventNode = facts.nodes.find((node) => node.id === 'history:cherry-pick:5:n');
    expect(eventNode).toMatchObject({ anchorCommitId: `commit:${oid('n')}`, eventBoundaryCommitId: `commit:${oid('b')}` });
    expect(facts.edges).toContainEqual(expect.objectContaining({
      type: 'history-event',
      fromNodeId: `commit:${oid('n')}`,
      toNodeId: 'history:cherry-pick:5:n',
      annotation: 'ref-event',
    }));
    expect(facts.edges.filter((edge) => edge.type === 'parent' && edge.fromNodeId === 'history:cherry-pick:5:n')).toHaveLength(0);
  });

  it('attaches an in-progress operation to Working Tree and keeps source edges separate from parents', () => {
    const operationSnapshot = { ...snapshot, operations: [{ type: 'cherry-pick' as const, headOid: oid('b'), sourceOids: [oid('a')] }] };
    const facts = buildGraphFacts(operationSnapshot);
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    expect(facts.nodes.some((node) => node.kind === 'operation')).toBe(false);
    expect(working?.operation).toEqual(operationSnapshot.operations[0]);
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'working-tree', fromNodeId: working?.id, toNodeId: `commit:${oid('b')}` }));
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'operation', fromNodeId: working?.id, toNodeId: `commit:${oid('a')}` }));
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

  it('marks shared commits as synchronized and only one-sided commits as unsynchronized', () => {
    const commits = [
      { oid: oid('c'), parentOids: [oid('b')], subject: 'C', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('b'), parentOids: [oid('a')], subject: 'B', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('a'), parentOids: [], subject: 'A', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('c') },
      { fullName: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote' as const, oid: oid('b') },
    ];
    const facts = buildGraphFacts({ ...snapshot, commits, refs, workingTrees: [], visibleCommitCount: commits.length });
    expect(facts.nodes.find((node) => node.oid === oid('c'))?.syncState).toBe('local-only');
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.syncState).toBe('shared');
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.syncState).toBe('shared');
  });

  it('marks remote-only commits in the same way as local-only commits', () => {
    const commits = [
      { oid: oid('c'), parentOids: [oid('b')], subject: 'C', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('b'), parentOids: [oid('a')], subject: 'B', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('a'), parentOids: [], subject: 'A', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('b') },
      { fullName: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote' as const, oid: oid('c') },
    ];
    const facts = buildGraphFacts({ ...snapshot, commits, refs, workingTrees: [], visibleCommitCount: commits.length });
    expect(facts.nodes.find((node) => node.oid === oid('c'))?.syncState).toBe('remote-only');
    expect(facts.nodes.find((node) => node.oid === oid('b'))?.syncState).toBe('shared');
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.syncState).toBe('shared');
  });

  it('marks both sides of a diverged history as unsynchronized while keeping the base shared', () => {
    const commits = [
      { oid: oid('l'), parentOids: [oid('a')], subject: 'local', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('r'), parentOids: [oid('a')], subject: 'remote', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('a'), parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const refs = [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('l') },
      { fullName: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote' as const, oid: oid('r') },
    ];
    const facts = buildGraphFacts({ ...snapshot, commits, refs, workingTrees: [], visibleCommitCount: commits.length });
    expect(facts.nodes.find((node) => node.oid === oid('l'))?.syncState).toBe('local-only');
    expect(facts.nodes.find((node) => node.oid === oid('r'))?.syncState).toBe('remote-only');
    expect(facts.nodes.find((node) => node.oid === oid('a'))?.syncState).toBe('shared');
  });
});
