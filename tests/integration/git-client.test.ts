import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { commitFixture, createGitFixture } from '../fixtures/gitFixture.js';

describe('GitClient integration fixture', () => {
  let fixture: ReturnType<typeof createGitFixture> | undefined;
  afterEach(() => fixture?.dispose());

  it('reads an actual branching repository with a clean working tree', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature/auth']);
    commitFixture(fixture, 'feature', '2026-08-27T10:00:00+09:00');
    fixture.run(['switch', 'main']);
    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    expect(snapshot.commits.some((commit) => commit.subject === 'feature')).toBe(true);
    expect(snapshot.refs.some((ref) => ref.shortName === 'feature/auth' && ref.type === 'local')).toBe(true);
    expect(snapshot.workingTrees[0]).toMatchObject({ branch: 'main', clean: true });
    const feature = snapshot.commits.find((commit) => commit.subject === 'feature');
    expect(feature).toMatchObject({ changedFiles: 1, additions: 1, deletions: 0 });
    const detail = await new GitClient().readCommitDetail(fixture.root, feature?.oid ?? '');
    expect(detail.fileChanges).toEqual([{ path: 'feature.txt', status: 'A', additions: 1, deletions: 0 }]);
    expect(snapshot.historyEvents).toHaveLength(0);
  });

  it('labels a reflog-proven fast-forward without inventing a merge commit', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature/ff']);
    commitFixture(fixture, 'feature tip', '2026-08-27T10:00:00+09:00');
    fixture.run(['switch', 'main']);
    fixture.run(['merge', '--ff-only', 'feature/ff']);
    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    expect(snapshot.commits.filter((commit) => commit.subject === 'feature tip')).toHaveLength(1);
    expect(snapshot.commits.find((commit) => commit.subject === 'feature tip')?.parentOids).toHaveLength(1);
    expect(snapshot.historyEvents.filter((event) => event.type === 'fast-forward')).toHaveLength(1);
    expect(snapshot.historyEvents.find((event) => event.type === 'fast-forward')).toMatchObject({ commitCount: 1, operation: 'merge' });
  });

  it('reads working-tree counts and an in-progress merge from Git metadata', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    fs.writeFileSync(path.join(fixture.root, 'staged.txt'), 'staged');
    fixture.run(['add', 'staged.txt']);
    fs.writeFileSync(path.join(fixture.root, 'base.txt'), 'unstaged');
    fs.writeFileSync(path.join(fixture.root, 'untracked.txt'), 'untracked');
    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.workingTrees[0]).toMatchObject({ staged: 1, unstaged: 1, untracked: 1, changedFiles: 3, additions: 2, deletions: 1, clean: false });

    fixture.run(['restore', '.']);
    fixture.run(['clean', '-fd']);
    fixture.run(['switch', '-c', 'feature/conflict']);
    fs.writeFileSync(path.join(fixture.root, 'base.txt'), 'feature');
    fixture.run(['add', 'base.txt']);
    fixture.run(['commit', '-m', 'feature conflict'], { GIT_AUTHOR_DATE: '2026-08-27T10:00:00+09:00', GIT_COMMITTER_DATE: '2026-08-27T10:00:00+09:00' });
    fixture.run(['switch', 'main']);
    fs.writeFileSync(path.join(fixture.root, 'base.txt'), 'main');
    fixture.run(['add', 'base.txt']);
    fixture.run(['commit', '-m', 'main conflict'], { GIT_AUTHOR_DATE: '2026-08-27T11:00:00+09:00', GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    try { fixture.run(['merge', 'feature/conflict']); } catch { /* expected conflict exit */ }
    snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations.some((operation) => operation.type === 'merge')).toBe(true);
    expect(snapshot.workingTrees[0]?.conflicted).toBeGreaterThan(0);
  });

  it('keeps an object-backed reset tip as a reflog-only commit with real parents', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    commitFixture(fixture, 'temporary tip', '2026-08-27T10:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['reset', '--hard', 'HEAD~1']);
    const snapshot = await new GitClient().readSnapshot(fixture.root, 1, true);
    expect(snapshot.commits.some((commit) => commit.oid === oldTip)).toBe(true);
    const facts = (await import('../../src/model/graphBuilder.js')).buildGraphFacts(snapshot);
    const oldNode = facts.nodes.find((node) => node.oid === oldTip);
    expect(oldNode?.kind).toBe('reflog-commit');
    expect(oldNode?.previousRoute).toBe(true);
    expect(facts.edges.some((edge) => edge.type === 'parent' && edge.fromNodeId === oldNode?.id)).toBe(true);
    expect(snapshot.historyEvents.some((event) => event.type === 'reset')).toBe(true);
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const oldLayoutNode = layout.nodes.find((node) => node.oid === oldTip);
    const currentLayoutNode = layout.nodes.find((node) => node.oid === snapshot.workingTrees[0]?.headOid);
    const historicalTrack = layout.tracks.find((track) => track.id === oldLayoutNode?.trackId);
    expect(historicalTrack?.family).toBe('historical');
    expect(oldLayoutNode?.lane).toBeGreaterThan(currentLayoutNode?.lane ?? -1);
    expect(historicalTrack?.color).toMatch(/^hsl\(220 8% 62%\)$/);
  });

  it('places an amended reflog commit on a gray previous route', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    commitFixture(fixture, 'old commit before amend', '2026-08-27T10:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(fixture.root, 'amended.txt'), 'amended content');
    fixture.run(['add', '.']);
    fixture.run(['commit', '--amend', '-m', 'amended commit'], { GIT_AUTHOR_DATE: '2026-08-27T11:00:00+09:00', GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    const snapshot = await new GitClient().readSnapshot(fixture.root, 1, true);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const oldNode = facts.nodes.find((node) => node.oid === oldTip);
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const oldLayoutNode = layout.nodes.find((node) => node.oid === oldTip);
    const currentLayoutNode = layout.nodes.find((node) => node.oid === snapshot.workingTrees[0]?.headOid);
    const historicalTrack = layout.tracks.find((track) => track.id === oldLayoutNode?.trackId);

    expect(oldNode?.kind).toBe('reflog-commit');
    expect(oldNode?.previousRoute).toBe(true);
    expect(snapshot.historyEvents.some((event) => event.type === 'amend')).toBe(true);
    expect(historicalTrack?.family).toBe('historical');
    expect(oldLayoutNode?.lane).toBeGreaterThan(currentLayoutNode?.lane ?? -1);
    expect(historicalTrack?.color).toMatch(/^hsl\(220 8% 62%\)$/);
  });

  it('keeps a long feature lane independent and preserves both merge parents', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'initial', '2026-08-27T09:00:00+09:00');
    const initialOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', '-c', 'feature/long']);
    commitFixture(fixture, 'feature one', '2026-08-27T10:00:00+09:00');
    commitFixture(fixture, 'feature two', '2026-08-27T11:00:00+09:00');
    commitFixture(fixture, 'feature three', '2026-08-27T12:00:00+09:00');
    const featureTipOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    fixture.run(['merge', '--no-ff', 'feature/long', '-m', 'Merge feature/long']);
    commitFixture(fixture, 'main after merge', '2026-08-27T14:00:00+09:00');
    const snapshot = await new GitClient().readSnapshot(fixture.root, 50, true);
    const mergeCommit = snapshot.commits.find((commit) => commit.subject === 'Merge feature/long');
    expect(snapshot.historyEvents.some((event) => event.type === 'fast-forward' && event.toOid === mergeCommit?.oid)).toBe(false);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    expect(mergeCommit?.parentOids).toHaveLength(2);
    const mergeNode = layout.nodes.find((node) => node.oid === mergeCommit?.oid);
    const featureNodes = layout.nodes.filter((node) => ['feature one', 'feature two', 'feature three'].includes(node.subject ?? ''));
    const featureLanes = new Set(featureNodes.map((node) => node.lane));
    expect(featureLanes.size).toBe(1);
    expect([...featureLanes][0]).not.toBe(mergeNode?.lane);
    expect(layout.edges.filter((edge) => edge.type === 'parent' && edge.fromNodeId === mergeNode?.id)).toHaveLength(2);
    expect(layout.nodes.find((node) => node.oid === initialOid)?.lane).toBe(mergeNode?.lane);
    expect(layout.nodes.find((node) => node.oid === featureTipOid)?.lane).toBe([...featureLanes][0]);
    expect(mergeCommit).toMatchObject({ changedFiles: 3, additions: 3, deletions: 0 });
    const mergeDetail = await new GitClient().readCommitDetail(fixture.root, mergeCommit?.oid ?? '');
    expect(mergeDetail).toMatchObject({ changedFiles: 3, additions: 3, deletions: 0 });
  });

  it('keeps a newly-created branch on one commit node and gives only its Working Tree a lane', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    const baseOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['update-ref', 'refs/remotes/origin/main', baseOid]);
    fixture.run(['switch', '-c', 'feat/test']);
    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    const facts = buildGraphFacts(snapshot, { showReflog: false });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const commitNodes = layout.nodes.filter((node) => node.kind === 'commit' && node.oid === baseOid);
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    expect(snapshot.refs.filter((ref) => ['main', 'origin/main', 'feat/test'].includes(ref.shortName)).map((ref) => ref.oid)).toEqual([baseOid, baseOid, baseOid]);
    expect(commitNodes).toHaveLength(1);
    expect(working?.workingTree?.branch).toBe('feat/test');
    expect(working?.lane).toBeGreaterThan(commitNodes[0]?.lane ?? -1);
    expect(facts.edges.filter((edge) => edge.type === 'parent')).toHaveLength(0);
    expect(facts.edges.filter((edge) => edge.type === 'working-tree')).toHaveLength(1);
  });

  it('moves the Working Tree and first real commit together onto the new branch lane', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    const baseOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['update-ref', 'refs/remotes/origin/main', baseOid]);
    fixture.run(['switch', '-c', 'feat/test']);
    const beforeSnapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    const beforeFacts = buildGraphFacts(beforeSnapshot, { showReflog: false });
    const beforeLayout = createGraphLayout(beforeFacts, { visibleCommitCount: beforeSnapshot.visibleCommitCount, hasMore: beforeSnapshot.hasMore, primaryBranch: beforeFacts.primaryBranch });
    const beforeWorking = beforeLayout.nodes.find((node) => node.kind === 'working-tree');
    const beforeTrack = beforeLayout.tracks.find((track) => track.id === beforeWorking?.trackId);
    commitFixture(fixture, 'first feature commit', '2026-08-27T10:00:00+09:00');
    const featureOid = fixture.run(['rev-parse', 'HEAD']).trim();
    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    const facts = buildGraphFacts(snapshot, { showReflog: false });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const featureNode = layout.nodes.find((node) => node.oid === featureOid && node.kind === 'commit');
    const baseNode = layout.nodes.find((node) => node.oid === baseOid && node.kind === 'commit');
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    expect(beforeWorking?.lane).toBeGreaterThan(0);
    expect(featureNode?.lane).toBe(beforeWorking?.lane);
    expect(layout.tracks.find((track) => track.id === beforeTrack?.id)?.color).toBe(beforeTrack?.color);
    expect(featureNode?.lane).toBeGreaterThan(baseNode?.lane ?? -1);
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'parent', fromNodeId: featureNode?.id, toNodeId: baseNode?.id }));
    expect(working?.oid).toBe(featureOid);
    expect(working?.lane).toBe(featureNode?.lane);
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'working-tree', fromNodeId: working?.id, toNodeId: featureNode?.id }));
    expect(facts.edges.some((edge) => edge.type === 'working-tree' && edge.toNodeId === baseNode?.id)).toBe(false);
  });
});
