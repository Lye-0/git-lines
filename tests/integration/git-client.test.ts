import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OperationType, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { GitClient } from '../../src/git/gitClient.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { pointForNode } from '../../src/layout/edgeRouter.js';
import { HISTORICAL_ROUTE_COLOR } from '../../src/utils/color.js';
import { createGraphColorResolver } from '../../webview/src/components/graphColor';
import { commitRowPresentation } from '../../webview/src/components/commitRowPresentation';
import { commitFixture, createGitFixture } from '../fixtures/gitFixture.js';

vi.setConfig({ testTimeout: 20_000 });

function commitText(fixture: ReturnType<typeof createGitFixture>, file: string, contents: string, message: string, date: string): void {
  fs.writeFileSync(path.join(fixture.root, file), contents);
  fixture.run(['add', file]);
  fixture.run(['commit', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

function assertWorkingTreeOperation(snapshot: RepositorySnapshot, type: OperationType): void {
  const facts = buildGraphFacts(snapshot, { showReflog: false });
  const workingNodes = facts.nodes.filter((node) => node.kind === 'working-tree');
  expect(workingNodes).toHaveLength(1);
  expect(facts.nodes.filter((node) => node.kind === 'operation')).toHaveLength(0);
  const working = workingNodes[0];
  expect(working?.operation?.type).toBe(type);
  const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
  expect(layout.nodes.filter((node) => node.kind === 'working-tree')).toHaveLength(1);
  expect(layout.nodes.filter((node) => node.kind === 'operation')).toHaveLength(0);
  for (const sourceOid of working?.operation?.sourceOids ?? []) {
    const source = facts.nodes.find((node) => node.oid === sourceOid);
    if (!source) continue;
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'operation', fromNodeId: working?.id, toNodeId: source.id }));
  }
}

function assertEventBoundary(layout: ReturnType<typeof createGraphLayout>, eventId: string, upperOid: string, boundaryOid: string): void {
  const upper = layout.nodes.find((node) => node.oid === upperOid);
  const event = layout.nodes.find((node) => node.id === eventId);
  const boundary = layout.nodes.find((node) => node.oid === boundaryOid);
  expect(upper).toBeDefined();
  expect(event).toBeDefined();
  expect(boundary).toBeDefined();
  expect(event).toMatchObject({
    eventStartCommitId: upper?.id,
    eventBoundaryCommitId: boundary?.id,
  });
  expect(upper?.row).toBeLessThan(event?.row ?? Number.MAX_SAFE_INTEGER);
  expect(event?.row).toBeLessThan(boundary?.row ?? Number.MAX_SAFE_INTEGER);
}

function assertExactOverlay(
  facts: ReturnType<typeof buildGraphFacts>,
  layout: ReturnType<typeof createGraphLayout>,
  kind: 'cherry-pick' | 'revert',
  sourceOid: string,
  targetOid: string,
): void {
  expect(facts.historyRelations).toContainEqual(expect.objectContaining({ kind, sourceOid, targetOid, evidence: 'reflog' }));
  expect(facts.nodes.some((node) => node.event?.type === kind && node.event.toOid === targetOid)).toBe(false);
  const sourceNode = layout.nodes.find((node) => node.oid === sourceOid);
  const targetNode = layout.nodes.find((node) => node.oid === targetOid);
  expect(layout.historyRelationPaths).toContainEqual(expect.objectContaining({
    sourceNodeId: sourceNode?.id,
    targetNodeId: targetNode?.id,
  }));
  expect(layout.operationAnnotationRows?.some((row) => facts.historyRelations?.some((relation) => relation.id === row.relationId && relation.kind === kind))).toBe(true);
}

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

  it('keeps the current detached HEAD commit live until HEAD leaves it', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'history.txt', 'initial\n', 'Initial commit', '2026-08-27T09:00:00+09:00');
    commitText(fixture, 'history.txt', 'main-one\n', 'Main commit one', '2026-08-27T10:00:00+09:00');
    const mainOneOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'history.txt', 'main-two\n', 'Main commit two', '2026-08-27T11:00:00+09:00');
    const mainTwoOid = fixture.run(['rev-parse', 'HEAD']).trim();

    fixture.run(['checkout', mainOneOid]);
    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    let current = snapshot.workingTrees.find((tree) => tree.currentWorktree === true);
    let facts = buildGraphFacts(snapshot, { showReflog: true });
    let head = facts.nodes.find((node) => node.oid === mainOneOid);

    expect(current).toMatchObject({ detached: true, headOid: mainOneOid });
    expect(head).toMatchObject({ kind: 'commit', previousRoute: false, historicalKind: undefined, refBadges: [], headState: 'detached' });
    expect(snapshot.refs.find((ref) => ref.fullName === 'refs/heads/main')?.oid).toBe(mainTwoOid);

    commitText(fixture, 'detached.txt', 'detached\n', 'New detached commit', '2026-08-27T12:00:00+09:00');
    const detachedOid = fixture.run(['rev-parse', 'HEAD']).trim();
    snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    current = snapshot.workingTrees.find((tree) => tree.currentWorktree === true);
    facts = buildGraphFacts(snapshot, { showReflog: true });
    head = facts.nodes.find((node) => node.oid === detachedOid);
    const working = facts.nodes.find((node) => node.kind === 'working-tree');
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const layoutHead = layout.nodes.find((node) => node.oid === detachedOid);

    expect(current).toMatchObject({ detached: true, headOid: detachedOid });
    expect(head).toMatchObject({ kind: 'commit', previousRoute: false, historicalKind: undefined, refBadges: [], headState: 'detached' });
    expect(facts.nodes.some((node) => node.historicalKind === 'unreferenced' && node.oid === detachedOid)).toBe(false);
    expect(facts.edges).toContainEqual(expect.objectContaining({
      type: 'working-tree',
      fromNodeId: working?.id,
      toNodeId: `commit:${detachedOid}`,
    }));
    expect(layout.tracks.find((track) => track.id === layoutHead?.trackId)?.family).not.toBe('historical');
    expect(createGraphColorResolver(layout).colorForNode(layoutHead!)).not.toBe(HISTORICAL_ROUTE_COLOR);

    const noReflogFacts = buildGraphFacts(await new GitClient().readSnapshot(fixture.root, 30, false), { showReflog: false });
    expect(noReflogFacts.nodes.find((node) => node.oid === detachedOid)).toMatchObject({ kind: 'commit', historicalKind: undefined });

    fixture.run(['switch', 'main']);
    snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    facts = buildGraphFacts(snapshot, { showReflog: true });
    head = facts.nodes.find((node) => node.oid === detachedOid);
    const attachedHead = facts.nodes.find((node) => node.oid === mainTwoOid);
    expect(snapshot.workingTrees.find((tree) => tree.currentWorktree === true)).toMatchObject({ detached: false, branch: 'main', headOid: mainTwoOid });
    expect(head).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: true });
    expect(head?.headState).toBeUndefined();
    expect(attachedHead?.headState).toBe('attached');

    const afterLeaveNoReflog = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(buildGraphFacts(afterLeaveNoReflog, { showReflog: false }).nodes.some((node) => node.oid === detachedOid)).toBe(false);
  });

  it('represents an actual linked worktree as a commit-row annotation', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'initial', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitFixture(fixture, 'linked feature commit', '2026-08-27T10:00:00+09:00');
    const featureOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    commitFixture(fixture, 'main commit', '2026-08-27T11:00:00+09:00');

    const linkedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-linked-'));
    fs.rmSync(linkedPath, { recursive: true, force: true });
    try {
      fixture.run(['worktree', 'add', linkedPath, 'feature']);
      const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
      const current = snapshot.workingTrees.find((tree) => tree.currentWorktree === true);
      const linked = snapshot.workingTrees.find((tree) => tree.currentWorktree === false);
      const expectedCurrentPath = fixture.root.replaceAll('\\', '/');
      const expectedLinkedPath = linkedPath.replaceAll('\\', '/');
      expect(current).toMatchObject({ path: expectedCurrentPath, branch: 'main' });
      expect(linked).toMatchObject({ path: expectedLinkedPath, branch: 'feature', headOid: featureOid });

      const facts = buildGraphFacts(snapshot, { showReflog: true });
      const featureNode = facts.nodes.find((node) => node.oid === featureOid);
      expect(facts.nodes.filter((node) => node.kind === 'working-tree')).toHaveLength(1);
      expect(facts.edges.filter((edge) => edge.type === 'working-tree')).toHaveLength(1);
      expect(featureNode?.linkedWorktrees).toEqual([expect.objectContaining({
        worktreeId: linked?.worktreeId,
        path: expectedLinkedPath,
        branch: 'feature',
        headOid: featureOid,
      })]);

      const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
      expect(layout.nodes.filter((node) => node.kind === 'working-tree')).toHaveLength(1);
      expect(layout.nodes.some((node) => node.id === `working:${linked?.worktreeId}`)).toBe(false);
      expect(layout.nodes.find((node) => node.oid === featureOid)?.linkedWorktrees).toHaveLength(1);
      expect(layout.tracks.some((track) => track.id === `worktree:${linked?.worktreeId}`)).toBe(false);
    } finally {
      try { fixture.run(['worktree', 'remove', '--force', linkedPath]); } catch { /* cleanup is best effort after a failed assertion */ }
      fs.rmSync(linkedPath, { recursive: true, force: true });
    }
  }, 20_000);

  it('reads an actual branch rename as one same-route event between Working Tree and HEAD', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'initial', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitFixture(fixture, 'Commit before branch rename', '2026-08-27T10:00:00+09:00');
    const headOid = fixture.run(['rev-parse', 'HEAD']).trim();
    const baseOid = fixture.run(['rev-parse', 'HEAD^']).trim();
    fixture.run(['branch', '-m', 'feature', 'feature-renamed']);

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const renameSubject = 'Branch: renamed refs/heads/feature to refs/heads/feature-renamed';
    expect(snapshot.reflogs.filter((entry) => entry.subject === renameSubject)).toHaveLength(2);
    const rename = snapshot.historyEvents.filter((event) => event.type === 'branch-rename');
    expect(rename).toHaveLength(1);
    expect(rename[0]).toMatchObject({
      refName: 'refs/heads/feature-renamed',
      toOid: headOid,
      fromRef: 'refs/heads/feature',
      toRef: 'refs/heads/feature-renamed',
      operation: 'Branch rename',
      rawReflogMessage: renameSubject,
    });

    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    const head = layout.nodes.find((node) => node.oid === headOid);
    const base = layout.nodes.find((node) => node.oid === baseOid);
    const event = layout.nodes.find((node) => node.event?.type === 'branch-rename');

    expect(working).toBeDefined();
    expect(head).toBeDefined();
    expect(base).toBeDefined();
    expect(event).toMatchObject({
      kind: 'history-event',
      anchorCommitId: head?.id,
      eventStartCommitId: head?.id,
      targetRef: 'refs/heads/feature-renamed',
      historicalEvent: false,
    });
    expect(working?.row).toBeLessThan(event?.row ?? Number.MAX_SAFE_INTEGER);
    expect(event?.row).toBeLessThan(head?.row ?? Number.MAX_SAFE_INTEGER);
    expect(head?.row).toBeLessThan(base?.row ?? Number.MAX_SAFE_INTEGER);
    expect(event?.trackId).toBe(head?.trackId);
    const workingEdge = facts.edges.find((edge) => edge.type === 'working-tree' && edge.toNodeId === head?.id);
    const renameAnnotation = facts.edges.find((edge) => edge.annotation === 'ref-event' && edge.toNodeId === event?.id);
    const splitPaths = layout.edgePaths?.filter((path) => path.edgeId === workingEdge?.id);
    const eventPoint = event ? pointForNode(event) : undefined;
    expect(workingEdge).toBeDefined();
    expect(renameAnnotation).toBeDefined();
    expect(splitPaths).toHaveLength(2);
    expect(splitPaths?.every((path) => path.type === 'working-tree')).toBe(true);
    expect(splitPaths?.some((path) => path.id === workingEdge?.id)).toBe(false);
    expect(layout.edgePaths?.some((path) => path.id === renameAnnotation?.id)).toBe(false);
    expect(splitPaths?.[0]).toMatchObject({ fromNodeId: working?.id, toNodeId: event?.id });
    expect(splitPaths?.[1]).toMatchObject({ fromNodeId: event?.id, toNodeId: head?.id });
    expect(splitPaths?.[0]?.d.endsWith(`${eventPoint?.x} ${eventPoint?.y}`)).toBe(true);
    expect(splitPaths?.[1]?.d.startsWith(`M ${eventPoint?.x} ${eventPoint?.y}`)).toBe(true);
    expect(head?.refBadges?.map((badge) => badge.name)).toContain('feature-renamed');
    expect(head?.refBadges?.map((badge) => badge.name)).not.toContain('feature');
    expect(facts.nodes.some((node) => node.historicalKind || node.previousRoute)).toBe(false);
    expect(layout.tracks.some((track) => track.historicalKind)).toBe(false);
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'working-tree', fromNodeId: working?.id, toNodeId: head?.id }));
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'parent', fromNodeId: head?.id, toNodeId: base?.id }));
    expect(facts.edges.some((edge) => edge.type === 'parent' && (edge.fromNodeId === event?.id || edge.toNodeId === event?.id))).toBe(false);

    const hiddenFacts = buildGraphFacts(snapshot, { showReflog: false });
    expect(hiddenFacts.events.filter((historyEvent) => historyEvent.type === 'branch-rename')).toEqual([]);
    expect(hiddenFacts.nodes.some((node) => node.event?.type === 'branch-rename')).toBe(false);
    const hiddenLayout = createGraphLayout(hiddenFacts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: hiddenFacts.primaryBranch });
    expect(hiddenLayout.nodes.some((node) => node.event?.type === 'branch-rename')).toBe(false);
    expect(hiddenLayout.nodes.find((node) => node.kind === 'working-tree')?.row).toBeLessThan(hiddenLayout.nodes.find((node) => node.oid === headOid)?.row ?? Number.MAX_SAFE_INTEGER);
    const hiddenHead = hiddenLayout.nodes.find((node) => node.oid === headOid);
    const hiddenWorkingEdge = hiddenFacts.edges.find((edge) => edge.type === 'working-tree' && edge.toNodeId === hiddenHead?.id);
    expect(hiddenWorkingEdge).toBeDefined();
    expect(hiddenLayout.edgePaths?.filter((path) => path.id === hiddenWorkingEdge?.id)).toHaveLength(1);
    expect(hiddenLayout.edgePaths?.find((path) => path.id === hiddenWorkingEdge?.id)).toMatchObject({
      type: 'working-tree',
    });
  });

  it('keeps 65 ref-only reset and branch-move events above the actual commit DAG', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'ref-moves.txt', 'base\n', 'Ref move initial', '2026-08-27T09:00:00+09:00');
    commitText(fixture, 'ref-moves.txt', 'main-one\n', 'Ref move main one', '2026-08-27T09:01:00+09:00');
    const mainOneOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'ref-moves.txt', 'main-two\n', 'Ref move main two', '2026-08-27T09:02:00+09:00');
    const mainTwoOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'ref-moves.txt', 'feature-one\n', 'Ref move feature one', '2026-08-27T09:03:00+09:00');
    fixture.run(['switch', 'main']);
    fixture.run(['reset', '--hard', 'HEAD~1']);
    fixture.run(['switch', 'feature']);
    fixture.run(['branch', '-f', 'main', 'HEAD~1']);
    fixture.run(['switch', 'main']);

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const reset = snapshot.historyEvents.find((event) => event.type === 'reset' && event.fromOid === mainTwoOid && event.toOid === mainOneOid);
    const move = snapshot.historyEvents.find((event) => event.type === 'branch-move' && event.fromOid === mainOneOid && event.toOid === mainTwoOid);
    expect(reset).toBeDefined();
    expect(move).toBeDefined();
    expect(snapshot.historyEvents.indexOf(move!)).toBeLessThan(snapshot.historyEvents.indexOf(reset!));

    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    expect(working?.workingTree).toMatchObject({ branch: 'main', headOid: mainTwoOid });
    expect(facts.refMovementRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reset', fromOid: mainTwoOid, toOid: mainOneOid }),
      expect.objectContaining({ kind: 'branch-move', fromOid: mainOneOid, toOid: mainTwoOid }),
    ]));
    expect(facts.nodes.some((node) => node.event?.type === 'reset' || node.event?.type === 'branch-move')).toBe(false);
    expect(layout.refMovementPaths).toHaveLength(2);
    expect(layout.refMovementPaths?.some((path) => path.kind === 'reset' && path.sourceNodeId === `commit:${mainTwoOid}` && path.targetNodeId === `commit:${mainOneOid}`)).toBe(true);
    expect(layout.refMovementPaths?.some((path) => path.kind === 'branch-move' && path.sourceNodeId === `commit:${mainOneOid}` && path.targetNodeId === `commit:${mainTwoOid}`)).toBe(true);
    expect(layout.operationAnnotationRows).toHaveLength(2);
    expect(layout.edgePaths?.filter((path) => path.id === `working:${working?.workingTree?.worktreeId}:commit:${mainTwoOid}`)).toHaveLength(1);

    const hiddenFacts = buildGraphFacts(snapshot, { showReflog: false });
    expect(hiddenFacts.events).toEqual([]);
    expect(hiddenFacts.refMovementRelations).toEqual([]);
    expect(hiddenFacts.nodes.some((node) => node.event?.type === 'reset' || node.event?.type === 'branch-move')).toBe(false);
  });

  it('keeps a deleted branch reflog path on a gray historical side lane', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'shared base', '2026-08-27T09:00:00+09:00');
    const baseOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'branch-one.txt', 'one\n', 'deleted branch B', '2026-08-27T10:00:00+09:00');
    const branchOneOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'branch-two.txt', 'two\n', 'deleted branch C', '2026-08-27T11:00:00+09:00');
    const branchTipOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    fixture.run(['branch', '-D', 'feature']);

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const branchTip = layout.nodes.find((node) => node.oid === branchTipOid);
    const branchOne = layout.nodes.find((node) => node.oid === branchOneOid);
    const base = layout.nodes.find((node) => node.oid === baseOid);
    const historicalTrack = layout.tracks.find((track) => track.id === branchTip?.trackId);
    const baseTrack = layout.tracks.find((track) => track.id === base?.trackId);

    expect(branchTip).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: true });
    expect(branchOne).toMatchObject({ kind: 'reflog-commit', historicalKind: 'unreferenced', historicalRouteHead: false });
    expect(branchOne?.trackId).toBe(branchTip?.trackId);
    expect(historicalTrack).toMatchObject({ family: 'historical', historicalKind: 'unreferenced' });
    expect(baseTrack?.family).toBe('main');
    expect(branchTip?.lane).toBeGreaterThan(base?.lane ?? -1);
    expect(commitRowPresentation(branchTip!).historicalBadgeLabel).toBe('UNREFERENCED');
    expect(commitRowPresentation(branchOne!).historicalBadgeLabel).toBeUndefined();

    const hidden = buildGraphFacts(snapshot, { showReflog: false });
    expect(hidden.nodes.some((node) => node.oid === branchTipOid || node.oid === branchOneOid)).toBe(false);
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
    assertWorkingTreeOperation(snapshot, 'merge');
  });

  it('represents a conflicted cherry-pick as one Working Tree with a direct source edge', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'source']);
    commitText(fixture, 'conflict.txt', 'source\n', 'source change', '2026-08-27T10:00:00+09:00');
    const sourceOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    commitText(fixture, 'conflict.txt', 'main\n', 'main change', '2026-08-27T11:00:00+09:00');
    try { fixture.run(['cherry-pick', sourceOid]); } catch { /* expected conflict exit */ }

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations).toContainEqual(expect.objectContaining({ type: 'cherry-pick', sourceOids: [sourceOid] }));
    expect(snapshot.workingTrees[0]?.conflicted).toBeGreaterThan(0);
    assertWorkingTreeOperation(snapshot, 'cherry-pick');
  });

  it('represents a conflicted rebase as one detached Working Tree', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'conflict.txt', 'feature\n', 'feature change', '2026-08-27T10:00:00+09:00');
    fixture.run(['switch', 'main']);
    commitText(fixture, 'conflict.txt', 'main\n', 'main change', '2026-08-27T11:00:00+09:00');
    fixture.run(['switch', 'feature']);
    try { fixture.run(['rebase', 'main']); } catch { /* expected conflict exit */ }

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations.some((operation) => operation.type === 'rebase')).toBe(true);
    expect(snapshot.workingTrees[0]).toMatchObject({ detached: true, conflicted: expect.any(Number) });
    expect(snapshot.workingTrees[0]?.conflicted).toBeGreaterThan(0);
    assertWorkingTreeOperation(snapshot, 'rebase');
  });

  it('coalesces completed rebase reflogs into one branch event and a historical old route', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'conflict.txt', 'feature\n', 'feature change', '2026-08-27T10:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    commitText(fixture, 'conflict.txt', 'main\n', 'main change', '2026-08-27T11:00:00+09:00');
    const newBase = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'feature']);
    try { fixture.run(['rebase', 'main']); } catch { /* expected conflict exit */ }

    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    expect(snapshot.operations.some((operation) => operation.type === 'rebase')).toBe(true);
    expect(snapshot.historyEvents.filter((event) => event.type === 'rebase')).toEqual([]);

    fs.writeFileSync(path.join(fixture.root, 'conflict.txt'), 'resolved\n');
    fixture.run(['add', 'conflict.txt']);
    fixture.run(['rebase', '--continue'], { GIT_EDITOR: 'true' });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();
    expect(newTip).not.toBe(oldTip);

    snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const rebaseEvents = snapshot.historyEvents.filter((event) => event.type === 'rebase');
    expect(rebaseEvents).toHaveLength(1);
    expect(rebaseEvents[0]).toMatchObject({ refName: 'refs/heads/feature', fromOid: oldTip, toOid: newTip });
    expect(rebaseEvents.some((event) => event.refName === 'HEAD')).toBe(false);

    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const oldNode = facts.nodes.find((node) => node.oid === oldTip);
    const newNode = facts.nodes.find((node) => node.oid === newTip);
    const event = rebaseEvents[0];
    const eventNode = event ? facts.nodes.find((node) => node.id === event.id) : undefined;
    expect(oldNode).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
    expect(newNode).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(eventNode).toMatchObject({ kind: 'history-event', historicalEvent: false, targetRef: 'refs/heads/feature' });

    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const oldLayoutNode = layout.nodes.find((node) => node.oid === oldTip);
    const newLayoutNode = layout.nodes.find((node) => node.oid === newTip);
    const working = layout.nodes.find((node) => node.kind === 'working-tree');
    const oldTrack = layout.tracks.find((track) => track.id === oldLayoutNode?.trackId);
    const newTrack = layout.tracks.find((track) => track.id === newLayoutNode?.trackId);
    const layoutEvent = event ? layout.nodes.find((node) => node.id === event.id) : undefined;
    expect(oldTrack?.family).toBe('historical');
    expect(newTrack?.family).toBe('feature');
    expect(oldTrack?.color).toBe(HISTORICAL_ROUTE_COLOR);
    expect(newTrack?.color).not.toBe(HISTORICAL_ROUTE_COLOR);
    expect(layoutEvent?.trackId).toBe(newLayoutNode?.trackId);
    expect(rebaseEvents[0]?.boundaryOid).toBe(newBase);
    assertEventBoundary(layout, event?.id ?? '', newTip, newBase);
    const singleRebaseParent = layout.edges.find((edge) => edge.type === 'parent'
      && edge.fromNodeId === newLayoutNode?.id
      && edge.toNodeId === layout.nodes.find((node) => node.oid === newBase)?.id);
    expect(singleRebaseParent).toBeDefined();
    expect(layout.edgePaths?.some((path) => path.id === singleRebaseParent?.id)).toBe(false);
    expect(layout.edgePaths?.filter((path) => path.edgeId === singleRebaseParent?.id)).toHaveLength(2);
    expect(layout.edgePaths).toContainEqual(expect.objectContaining({
      id: `${event?.id}:rebase:before`,
      fromNodeId: newLayoutNode?.id,
      toNodeId: layoutEvent?.id,
    }));
    expect(layout.edgePaths).toContainEqual(expect.objectContaining({
      id: `${event?.id}:rebase:after`,
      fromNodeId: layoutEvent?.id,
      toNodeId: layout.nodes.find((node) => node.oid === newBase)?.id,
    }));
    expect(working?.workingTree).toMatchObject({ branch: 'feature', headOid: newTip, clean: true });
    expect(facts.edges).toContainEqual(expect.objectContaining({ type: 'working-tree', fromNodeId: working?.id, toNodeId: newLayoutNode?.id }));
  });

  it('places a completed cherry-pick event between the new commit and the old main tip', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'source']);
    commitText(fixture, 'source.txt', 'source\n', 'source change', '2026-08-27T10:00:00+09:00');
    const sourceOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['cherry-pick', '-x', '--no-edit', sourceOid], { GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'cherry-pick');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refName: 'refs/heads/main', fromOid: oldTip, toOid: newTip, boundaryOid: oldTip, sourceOid });
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertExactOverlay(facts, layout, 'cherry-pick', sourceOid, newTip);
    expect(facts.nodes.find((node) => node.oid === sourceOid)).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(facts.edges).not.toContainEqual(expect.objectContaining({ type: 'history-event', fromNodeId: `commit:${sourceOid}` }));
    expect(facts.edges).not.toContainEqual(expect.objectContaining({ type: 'parent', fromNodeId: `commit:${newTip}`, toNodeId: `commit:${sourceOid}` }));
    const hidden = buildGraphFacts(snapshot, { showReflog: false });
    expect(hidden.historyRelations).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === sourceOid)?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === newTip)?.kind).toBe('commit');
  });

  it('resolves a completed conflicted cherry-pick from the branch reflog', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'source']);
    commitText(fixture, 'conflict.txt', 'source\n', 'source change', '2026-08-27T10:00:00+09:00');
    const sourceOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    commitText(fixture, 'conflict.txt', 'main\n', 'main change', '2026-08-27T11:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    try { fixture.run(['cherry-pick', sourceOid]); } catch { /* expected conflict exit */ }

    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations).toContainEqual(expect.objectContaining({ type: 'cherry-pick', sourceOids: [sourceOid] }));
    expect(snapshot.historyEvents.filter((event) => event.type === 'cherry-pick')).toHaveLength(0);

    fs.writeFileSync(path.join(fixture.root, 'conflict.txt'), 'resolved cherry-pick\n');
    fixture.run(['add', 'conflict.txt']);
    fixture.run(['cherry-pick', '--continue'], {
      GIT_EDITOR: 'true',
      GIT_COMMITTER_DATE: '2026-08-27T12:00:00+09:00',
    });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();
    const branchReflog = fixture.run(['reflog', 'show', '-1', '--format=%H %gD %gs', 'refs/heads/main']);
    expect(branchReflog).toContain(newTip);
    expect(branchReflog).toContain('commit (cherry-pick):');

    snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'cherry-pick');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refName: 'refs/heads/main', fromOid: oldTip, toOid: newTip, boundaryOid: oldTip });
    expect(events[0]?.sourceOid).toBeUndefined();
    expect(events.some((event) => event.refName === 'HEAD')).toBe(false);

    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertEventBoundary(layout, events[0]?.id ?? '', newTip, oldTip);
    expect(facts.historyRelations?.some((relation) => relation.kind === 'cherry-pick')).toBe(false);
    expect(facts.nodes.find((node) => node.id === events[0]?.id)?.kind).toBe('history-event');
    expect(facts.edges).not.toContainEqual(expect.objectContaining({ type: 'history-event', fromNodeId: `commit:${sourceOid}` }));
    expect(facts.edges).not.toContainEqual(expect.objectContaining({ type: 'parent', fromNodeId: `commit:${newTip}`, toNodeId: `commit:${sourceOid}` }));
  });

  it('places a completed revert event between the new revert commit and its parent', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    commitText(fixture, 'target.txt', 'target\n', 'target change', '2026-08-27T10:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['revert', '--no-edit', oldTip], { GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'revert');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refName: 'refs/heads/main', fromOid: oldTip, toOid: newTip, boundaryOid: oldTip, targetOid: oldTip });
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertExactOverlay(facts, layout, 'revert', oldTip, newTip);
    const revertPath = layout.historyRelationPaths?.find((path) => path.kind === 'revert');
    expect(revertPath?.arrowD).toBe('');
    expect(revertPath?.sourceMarkerD).toMatch(/^M /);
    expect(facts.nodes.find((node) => node.oid === oldTip)).toMatchObject({ kind: 'commit', previousRoute: false });
    const hidden = buildGraphFacts(snapshot, { showReflog: false });
    expect(hidden.historyRelations).toEqual([]);
    expect(createGraphLayout(hidden, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch }).historyRelationPaths).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === oldTip)?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === newTip)?.kind).toBe('commit');
  });

  it('resolves a completed conflicted revert from the branch reflog', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    commitText(fixture, 'conflict.txt', 'target\n', 'commit to revert', '2026-08-27T10:00:00+09:00');
    const targetOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'conflict.txt', 'later\n', 'later change', '2026-08-27T11:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    try { fixture.run(['revert', targetOid]); } catch { /* expected conflict exit */ }

    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations).toContainEqual(expect.objectContaining({ type: 'revert', sourceOids: [targetOid] }));
    expect(snapshot.historyEvents.filter((event) => event.type === 'revert')).toHaveLength(0);

    fs.writeFileSync(path.join(fixture.root, 'conflict.txt'), 'resolved revert\n');
    fixture.run(['add', 'conflict.txt']);
    fixture.run(['revert', '--continue'], {
      GIT_EDITOR: 'true',
      GIT_COMMITTER_DATE: '2026-08-27T12:00:00+09:00',
    });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();
    const branchReflog = fixture.run(['reflog', 'show', '-1', '--format=%H %gD %gs', 'refs/heads/main']);
    expect(branchReflog).toContain(newTip);
    expect(branchReflog).toContain('commit: Revert ');

    snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'revert');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refName: 'refs/heads/main', fromOid: oldTip, toOid: newTip, boundaryOid: oldTip, targetOid });
    expect(events.some((event) => event.refName === 'HEAD')).toBe(false);

    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertExactOverlay(facts, layout, 'revert', targetOid, newTip);
    expect(facts.nodes.find((node) => node.oid === targetOid)).toMatchObject({ kind: 'commit', previousRoute: false });
  });

  it('does not invent a cherry-pick overlay after a plain cherry-pick without -x', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'source']);
    commitText(fixture, 'source.txt', 'source\n', 'source change', '2026-08-27T10:00:00+09:00');
    const sourceOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['cherry-pick', '--no-edit', sourceOid], { GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'cherry-pick');
    expect(events).toHaveLength(1);
    expect(events[0]?.sourceOid).toBeUndefined();
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    expect(facts.historyRelations).toEqual([]);
    assertEventBoundary(layout, events[0]?.id ?? '', newTip, oldTip);
  });

  it('keeps exact cherry-pick and revert overlays together on one graph', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'source']);
    commitText(fixture, 'source.txt', 'source\n', 'source change', '2026-08-27T10:00:00+09:00');
    const sourceOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    fixture.run(['cherry-pick', '-x', '--no-edit', sourceOid], { GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });
    const cherryOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['revert', '--no-edit', cherryOid], { GIT_COMMITTER_DATE: '2026-08-27T12:00:00+09:00' });
    const revertOid = fixture.run(['rev-parse', 'HEAD']).trim();

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertExactOverlay(facts, layout, 'cherry-pick', sourceOid, cherryOid);
    assertExactOverlay(facts, layout, 'revert', cherryOid, revertOid);
    expect(facts.historyRelations).toHaveLength(2);
    expect(layout.operationAnnotationRows).toHaveLength(2);
    expect(facts.nodes.find((node) => node.oid === sourceOid)?.previousRoute).toBe(false);
    expect(facts.nodes.find((node) => node.oid === cherryOid)?.previousRoute).toBe(false);
  });

  it('places a multi-commit rebase event at the bottom of the rewritten range', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'feature-one.txt', 'one\n', 'feature one', '2026-08-27T10:00:00+09:00');
    const oldFirst = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'feature-two.txt', 'two\n', 'feature two', '2026-08-27T11:00:00+09:00');
    const oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'main']);
    commitText(fixture, 'main.txt', 'main\n', 'main change', '2026-08-27T12:00:00+09:00');
    const newBase = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['switch', 'feature']);
    fixture.run(['rebase', 'main'], { GIT_COMMITTER_DATE: '2026-08-27T13:00:00+09:00' });
    const newTip = fixture.run(['rev-parse', 'HEAD']).trim();
    const newFirst = fixture.run(['rev-parse', 'HEAD^']).trim();

    const snapshot = await new GitClient().readSnapshot(fixture.root, 50, true);
    const events = snapshot.historyEvents.filter((event) => event.type === 'rebase');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refName: 'refs/heads/feature', fromOid: oldTip, toOid: newTip, boundaryOid: newBase });
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    assertEventBoundary(layout, events[0]?.id ?? '', newFirst, newBase);
    const newTipNode = layout.nodes.find((node) => node.oid === newTip)!;
    const newFirstNode = layout.nodes.find((node) => node.oid === newFirst)!;
    const eventNode = layout.nodes.find((node) => node.id === events[0]?.id)!;
    expect(newTipNode.row).toBeLessThan(newFirstNode.row!);
    expect(newFirstNode.row).toBeLessThan(eventNode.row!);
    const bottomRebaseParent = layout.edges.find((edge) => edge.type === 'parent'
      && edge.fromNodeId === newFirstNode.id
      && edge.toNodeId === layout.nodes.find((node) => node.oid === newBase)?.id);
    const upperRebaseParent = layout.edges.find((edge) => edge.type === 'parent'
      && edge.fromNodeId === newTipNode.id
      && edge.toNodeId === newFirstNode.id);
    expect(bottomRebaseParent).toBeDefined();
    expect(layout.edgePaths?.some((path) => path.id === bottomRebaseParent?.id)).toBe(false);
    expect(layout.edgePaths?.filter((path) => path.edgeId === bottomRebaseParent?.id)).toHaveLength(2);
    expect(layout.edgePaths?.some((path) => path.id === upperRebaseParent?.id)).toBe(true);
    expect(layout.nodes.find((node) => node.oid === oldFirst)).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
    expect(layout.nodes.find((node) => node.oid === oldTip)).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
  });

  it('does not add a History Event for a completed real merge commit', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'base.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature']);
    commitText(fixture, 'feature.txt', 'feature\n', 'feature change', '2026-08-27T10:00:00+09:00');
    fixture.run(['switch', 'main']);
    fixture.run(['merge', '--no-ff', 'feature', '-m', 'Merge feature'], { GIT_COMMITTER_DATE: '2026-08-27T11:00:00+09:00' });

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    const merge = snapshot.commits.find((commit) => commit.subject === 'Merge feature');
    expect(merge?.parentOids).toHaveLength(2);
    expect(snapshot.historyEvents).toHaveLength(0);
  });

  it('represents a conflicted revert as one Working Tree with the operation attached', async () => {
    fixture = createGitFixture();
    commitText(fixture, 'conflict.txt', 'base\n', 'base', '2026-08-27T09:00:00+09:00');
    commitText(fixture, 'conflict.txt', 'target\n', 'commit to revert', '2026-08-27T10:00:00+09:00');
    const targetOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitText(fixture, 'conflict.txt', 'later\n', 'later change', '2026-08-27T11:00:00+09:00');
    try { fixture.run(['revert', targetOid]); } catch { /* expected conflict exit */ }

    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.operations.some((operation) => operation.type === 'revert')).toBe(true);
    expect(snapshot.workingTrees[0]?.conflicted).toBeGreaterThan(0);
    assertWorkingTreeOperation(snapshot, 'revert');
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
    const resetEvent = snapshot.historyEvents.find((event) => event.type === 'reset' && event.toOid === snapshot.workingTrees[0]?.headOid);
    expect(resetEvent?.boundaryOid).toBe(snapshot.workingTrees[0]?.headOid);
    expect(facts.refMovementRelations).toContainEqual(expect.objectContaining({ kind: 'reset', fromOid: oldTip, toOid: snapshot.workingTrees[0]?.headOid }));
    expect(layout.nodes.find((node) => node.id === resetEvent?.id)).toBeUndefined();
    expect(oldLayoutNode?.ghostRefBadges?.map((badge) => badge.name)).toEqual(['main']);
    expect(layout.refMovementPaths).toEqual([expect.objectContaining({ kind: 'reset', sourceNodeId: oldLayoutNode?.id, targetNodeId: currentLayoutNode?.id })]);
  });

  it('repositions an older reset event when a later reset makes its destination historical', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'initial', '2026-08-27T09:00:00+09:00');
    const initialOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitFixture(fixture, 'reset soft commit one', '2026-08-27T10:00:00+09:00');
    const firstDestinationOid = fixture.run(['rev-parse', 'HEAD']).trim();
    commitFixture(fixture, 'reset soft commit two', '2026-08-27T11:00:00+09:00');
    commitFixture(fixture, 'reset soft commit three', '2026-08-27T12:00:00+09:00');
    const firstFromOid = fixture.run(['rev-parse', 'HEAD']).trim();

    fixture.run(['reset', '--soft', firstDestinationOid]);
    commitFixture(fixture, 'replacement after first reset', '2026-08-27T13:00:00+09:00');
    const secondFromOid = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['reset', '--soft', initialOid]);

    const snapshot = await new GitClient().readSnapshot(fixture.root, 1, true);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, primaryBranch: facts.primaryBranch });
    const firstReset = facts.events.find((event) => event.type === 'reset' && event.fromOid === firstFromOid && event.toOid === firstDestinationOid);
    const secondReset = facts.events.find((event) => event.type === 'reset' && event.fromOid === secondFromOid && event.toOid === initialOid);
    const firstDestinationNode = layout.nodes.find((node) => node.oid === firstDestinationOid);
    const initialNode = layout.nodes.find((node) => node.oid === initialOid);
    const firstFromNode = layout.nodes.find((node) => node.oid === firstFromOid);
    const secondFromNode = layout.nodes.find((node) => node.oid === secondFromOid);

    expect(firstReset).toBeDefined();
    expect(secondReset).toBeDefined();
    expect(facts.refMovementRelations).toHaveLength(2);
    expect(facts.refMovementRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reset', fromOid: firstFromOid, toOid: firstDestinationOid }),
      expect.objectContaining({ kind: 'reset', fromOid: secondFromOid, toOid: initialOid }),
    ]));
    expect(layout.nodes.some((node) => node.event?.type === 'reset')).toBe(false);
    expect(firstDestinationNode?.previousRoute).toBe(true);
    expect(initialNode?.previousRoute).toBe(false);
    expect(initialNode?.refBadges?.map((badge) => badge.name)).toContain('main');
    expect(firstFromNode?.ghostRefBadges?.map((badge) => badge.name)).toContain('main');
    expect(secondFromNode?.ghostRefBadges?.map((badge) => badge.name)).toContain('main');
    expect(layout.refMovementPaths).toHaveLength(2);
  });

  it('places an amended reflog commit on a gray previous route and emits one overlay relation', async () => {
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
    const currentLayoutNode = layout.nodes.find((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid === snapshot.workingTrees[0]?.headOid);
    const amendEvent = snapshot.historyEvents.find((event) => event.type === 'amend');
    const baseLayoutNode = layout.nodes.find((node) => node.subject === 'base');
    const historicalTrack = layout.tracks.find((track) => track.id === oldLayoutNode?.trackId);

    expect(oldNode?.kind).toBe('reflog-commit');
    expect(oldNode?.previousRoute).toBe(true);
    expect(snapshot.historyEvents.some((event) => event.type === 'amend')).toBe(true);
    expect(facts.historyRelations).toHaveLength(1);
    expect(facts.historyRelations?.[0]).toMatchObject({ kind: 'amend', sourceOid: oldTip, targetOid: snapshot.workingTrees[0]?.headOid, evidence: 'reflog' });
    expect(historicalTrack?.family).toBe('historical');
    expect(oldLayoutNode?.lane).toBeGreaterThan(currentLayoutNode?.lane ?? -1);
    expect(historicalTrack?.color).toMatch(/^hsl\(220 8% 62%\)$/);
    expect(amendEvent?.boundaryOid).toBe(baseLayoutNode?.oid);
    expect(layout.nodes.find((node) => node.id === amendEvent?.id)).toBeUndefined();
    expect(currentLayoutNode?.row).toBeLessThan(oldLayoutNode?.row ?? Number.MAX_SAFE_INTEGER);
    expect(layout.historyRelationPaths).toEqual([expect.objectContaining({ relationId: amendEvent?.id, sourceNodeId: oldLayoutNode?.id, targetNodeId: currentLayoutNode?.id })]);
    expect(layout.edges.filter((edge) => edge.type === 'history-event' && edge.annotation === 'ref-event')).toHaveLength(0);
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
