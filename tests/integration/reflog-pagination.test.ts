import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitClient } from '../../src/git/gitClient.js';
import { GitRunner, type GitRunOptions } from '../../src/git/gitRunner.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { parseReflogRecords, reflogFormat } from '../../src/git/parsers/reflogParser.js';
import { createGitFixture, commitFixture } from '../fixtures/gitFixture.js';

class CountingRunner extends GitRunner {
  readonly shows: string[][] = [];
  readonly calls: string[][] = [];
  missingOid?: string;
  readers = 0;
  override openObjectReader(options: GitRunOptions) {
    this.readers++;
    const reader = super.openObjectReader(options);
    return { read: (oid: string) => oid === this.missingOid ? Promise.resolve(undefined) : reader.read(oid), close: () => reader.close() };
  }

  override async run(args: string[], options: GitRunOptions) {
    this.calls.push(args);
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
  it('bounds Reflog concurrency and preserves sequential results despite reordered completion and a missing log', async () => {
    const repo = createGitFixture();
    try {
      commitFixture(repo, 'Base', '2025-01-01T00:00:00Z');
      for (let i = 0; i < 9; i++) repo.run(['branch', `branch${i}`]);
      class ParallelRunner extends GitRunner {
        active = 0;
        maximum = 0;
        completed: string[] = [];
        override async run(args: string[], options: GitRunOptions) {
          if (args[0] !== 'reflog') return super.run(args, options);
          this.active++;
          this.maximum = Math.max(this.maximum, this.active);
          const ref = args.at(-1)!;
          try {
            if (ref === 'HEAD') await new Promise((resolve) => setTimeout(resolve, 150));
            if (ref === 'refs/heads/branch3') return { stdout: '', stderr: 'missing reflog', exitCode: 128 };
            return await super.run(args, options);
          } finally { this.completed.push(ref); this.active--; }
        }
      }
      const runner = new ParallelRunner();
      const snapshot = await new GitClient({ runner }).readSnapshot(repo.root, 30, true);
      const names = ['HEAD', ...snapshot.refs.filter((ref) => ref.type === 'local').map((ref) => ref.fullName)];
      const expected = [];
      for (const ref of names.filter((ref) => ref !== 'refs/heads/branch3')) {
        expected.push(...parseReflogRecords(repo.run(['reflog', 'show', `--format=${reflogFormat}`, ref]), ref));
      }
      expect(snapshot.reflogs).toEqual(expected);
      expect(runner.maximum).toBeGreaterThan(1);
      expect(runner.maximum).toBeLessThanOrEqual(4);
      expect(runner.completed[0]).not.toBe('HEAD');
      expect(runner.completed).toHaveLength(names.length);
      expect(runner.active).toBe(0);
    } finally { repo.dispose(); }
  }, 20000);
  it('measures successful and failed Git commands without logging arguments', async () => {
    const measurements: Array<{ command: string; ms: number; bytes: number; ok: boolean }> = [];
    const runner = new GitRunner('git', (command, ms, bytes, ok) => measurements.push({ command, ms, bytes, ok }));
    await runner.runChecked(['--version'], { cwd: fixture.root });
    await expect(runner.runChecked(['not-a-git-lines-command'], { cwd: fixture.root })).rejects.toThrow();
    expect(measurements).toHaveLength(2);
    expect(measurements[0]).toMatchObject({ command: '--version', ok: true });
    expect(measurements[0].bytes).toBeGreaterThan(0);
    expect(measurements[1]).toMatchObject({ command: 'not-a-git-lines-command', ok: false });
    expect(measurements.every((item) => Number.isFinite(item.ms) && item.ms >= 0)).toBe(true);
  });
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
      expect(runner.readers).toBe(1);
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

  it('reuses unchanged pages and reflogs, reads only the next ten commits, and can force a fresh read', async () => {
    const runner = new CountingRunner();
    const client = new GitClient({ runner });
    await client.readSnapshot(fixture.root, 30, true);
    runner.calls.length = 0;
    const appended = await client.readSnapshot(fixture.root, 40, true);
    const logs = runner.calls.filter((args) => args[0] === 'log');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('--skip=30');
    expect(logs[0][logs[0].indexOf('-n') + 1]).toBe('10');
    expect(runner.calls.filter((args) => args[0] === 'reflog')).toHaveLength(0);
    expect(runner.calls.filter((args) => args[0] === 'show')).toHaveLength(0);
    const fresh = await new GitClient().readSnapshot(fixture.root, 40, true);
    expect(appended.commits).toEqual(fresh.commits);
    expect(appended.historyEvents).toEqual(fresh.historyEvents);
    runner.calls.length = 0;
    await client.readSnapshot(fixture.root, 40, true);
    expect(runner.calls.some((args) => args[0] === 'log')).toBe(false);
    expect(runner.calls.some((args) => args[0] === 'status')).toBe(true);
    client.clearCache();
    runner.calls.length = 0;
    await client.readSnapshot(fixture.root, 40, true);
    expect(runner.calls.some((args) => args[0] === 'log' && !args.some((arg) => arg.startsWith('--skip=')))).toBe(true);
    expect(runner.calls.some((args) => args[0] === 'reflog')).toBe(true);
  }, 20000);

  it('invalidates a moved HEAD and expired reflogs instead of retaining stale history', async () => {
    const runner = new CountingRunner();
    const client = new GitClient({ runner });
    await client.readSnapshot(fixture.root, 30, true);
    fixture.run(['commit', '--allow-empty', '-m', 'Cache invalidation']);
    const head = fixture.run(['rev-parse', 'HEAD']).trim();
    runner.calls.length = 0;
    const changed = await client.readSnapshot(fixture.root, 40, true);
    expect(changed.commits[0].oid).toBe(head);
    expect(runner.calls.some((args) => args[0] === 'log' && !args.some((arg) => arg.startsWith('--skip=')))).toBe(true);
    fixture.run(['reflog', 'expire', '--expire=now', '--all']);
    const expired = await client.readSnapshot(fixture.root, 40, true);
    expect(expired.reflogs).toEqual([]);
    expect(expired.commits.some((commit) => commit.oid === oldTip)).toBe(false);
  }, 20000);

  it('keeps anchored page ordering equal to a fresh read across branches, tags and detached HEAD', async () => {
    const repo = createGitFixture();
    try {
      commitFixture(repo, 'Root', '2025-01-01T00:00:00Z');
      repo.run(['branch', 'side']);
      for (let i = 0; i < 5; i++) repo.run(['commit', '--allow-empty', '-m', `main ${i}`]);
      repo.run(['tag', '-a', 'v-cache', '-m', 'tag']);
      repo.run(['checkout', 'side']);
      for (let i = 0; i < 5; i++) repo.run(['commit', '--allow-empty', '-m', `side ${i}`]);
      repo.run(['checkout', '--detach', 'HEAD']);
      repo.run(['commit', '--allow-empty', '-m', 'detached']);
      const client = new GitClient();
      const first = await client.readSnapshot(repo.root, 3, false);
      const appended = await client.readSnapshot(repo.root, 8, false);
      const fresh = await new GitClient().readSnapshot(repo.root, 8, false);
      expect(appended.commits).toEqual(fresh.commits);
      expect(appended.commits.slice(0, 3)).toEqual(first.commits);
    } finally { repo.dispose(); }
  }, 20000);
});
