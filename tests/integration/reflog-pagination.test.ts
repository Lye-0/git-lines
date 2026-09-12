import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitClient } from '../../src/git/gitClient.js';
import { GitRunner, type GitRunOptions } from '../../src/git/gitRunner.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGitFixture, commitFixture } from '../fixtures/gitFixture.js';

class CountingRunner extends GitRunner {
  readonly shows: string[][] = [];
  missingOid?: string;

  override async run(args: string[], options: GitRunOptions) {
    if (args[0] === 'show') {
      this.shows.push(args);
      if (this.missingOid && args.includes(this.missingOid)) {
        return { stdout: '', stderr: `fatal: bad object ${this.missingOid}`, exitCode: 128 };
      }
    }
    return super.run(args, options);
  }
}

describe('reflog pagination and batched object reads', () => {
  let fixture: ReturnType<typeof createGitFixture>;
  let oldTip: string;
  let newTip: string;

  beforeAll(() => {
    fixture = createGitFixture();
    commitFixture(fixture, 'Base', '2025-01-01T00:00:00Z');
    for (let index = 1; index <= 49; index += 1) {
      fixture.run(['commit', '--allow-empty', '-m', `Commit ${index}`]);
    }
    oldTip = fixture.run(['rev-parse', 'HEAD']).trim();
    fixture.run(['commit', '--amend', '--allow-empty', '-m', 'Amended tip']);
    newTip = fixture.run(['rev-parse', 'HEAD']).trim();
  }, 20000);

  afterAll(() => fixture?.dispose());

  it('keeps live history at 30 then 40 commits while retaining the actual amend relation', async () => {
    for (const limit of [30, 40]) {
      const runner = new CountingRunner();
      const snapshot = await new GitClient({ runner }).readSnapshot(fixture.root, limit, true);
      const facts = buildGraphFacts(snapshot, { showReflog: true });
      expect(snapshot.visibleCommitCount).toBe(limit);
      expect(snapshot.hasMore).toBe(true);
      expect(facts.nodes.filter((node) => node.kind === 'commit')).toHaveLength(limit);
      expect(facts.nodes.find((node) => node.oid === oldTip)).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
      expect(facts.historyRelations).toContainEqual(expect.objectContaining({ kind: 'amend', sourceOid: oldTip, targetOid: newTip }));
      expect(runner.shows.length).toBeLessThanOrEqual(3);
      expect(runner.shows.some((args) => args.filter((arg) => /^[0-9a-f]{40}$/.test(arg)).length > 1)).toBe(true);
    }
  }, 20000);

  it('isolates an expired object without losing other commits in the batch', async () => {
    const runner = new CountingRunner();
    runner.missingOid = oldTip;
    const snapshot = await new GitClient({ runner }).readSnapshot(fixture.root, 30, true);
    expect(snapshot.commits.some((commit) => commit.oid === oldTip)).toBe(false);
    expect(new Set(snapshot.commits.map((commit) => commit.oid)).size).toBe(50);
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    expect(facts.nodes.filter((node) => node.kind === 'commit')).toHaveLength(30);
    expect(facts.historyRelations).toHaveLength(0);
  }, 20000);
});
