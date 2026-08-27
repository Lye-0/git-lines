import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GitClient } from '../../src/git/gitClient.js';
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
    expect(snapshot.historyEvents.length).toBeGreaterThanOrEqual(1);
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
    expect(snapshot.historyEvents.some((event) => event.type === 'fast-forward')).toBe(true);
  });

  it('reads working-tree counts and an in-progress merge from Git metadata', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    fs.writeFileSync(path.join(fixture.root, 'staged.txt'), 'staged');
    fixture.run(['add', 'staged.txt']);
    fs.writeFileSync(path.join(fixture.root, 'base.txt'), 'unstaged');
    fs.writeFileSync(path.join(fixture.root, 'untracked.txt'), 'untracked');
    let snapshot = await new GitClient().readSnapshot(fixture.root, 30, false);
    expect(snapshot.workingTrees[0]).toMatchObject({ staged: 1, unstaged: 1, untracked: 1, clean: false });

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
    expect(facts.edges.some((edge) => edge.type === 'parent' && edge.fromNodeId === oldNode?.id)).toBe(true);
    expect(snapshot.historyEvents.some((event) => event.type === 'reset')).toBe(true);
  });
});
