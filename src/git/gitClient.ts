import fs from 'node:fs/promises';
import path from 'node:path';
import { RepositoryDiscovery } from '../repository/repositoryDiscovery.js';
import { GitCommandError, GitRunner } from './gitRunner.js';
import type {
  GitCommit,
  GitCommitDetail,
  GitRef,
  HistoryEvent,
  ReflogEntry,
  RepositoryInfo,
  RepositorySnapshot,
  WorkingTreeState,
} from './gitTypes.js';
import { OperationStateReader } from './operationStateReader.js';
import { gitLogNumstatFormat, gitLogFormat, parseGitLogNumstat, parseGitLogNul } from './parsers/logParser.js';
import { parseRefRecords, refFormat } from './parsers/refParser.js';
import { parseReflogRecords, reflogFormat } from './parsers/reflogParser.js';
import { parsePorcelainV2, toWorkingTreeState } from './parsers/statusParser.js';
import { parseNameStatus, parseNumstat, sumNumstat } from './parsers/diffParser.js';
import { parseWorktreePorcelain } from './parsers/worktreeParser.js';
import type { ParsedWorktree } from './parsers/worktreeParser.js';
import { resolveHistoryEvents } from '../model/historyEventResolver.js';

export interface GitClientOptions {
  runner?: GitRunner;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 12000;

function isUnsupportedDiffMergeOption(error: unknown): boolean {
  return error instanceof GitCommandError && /diff-merges|unknown option|unrecognized (?:argument|option)|invalid option/i.test(error.stderr);
}

export class GitClient {
  public readonly runner: GitRunner;
  private readonly discovery: RepositoryDiscovery;
  private readonly operations: OperationStateReader;
  private readonly timeoutMs: number;

  public constructor(options: GitClientOptions = {}) {
    this.runner = options.runner ?? new GitRunner();
    this.discovery = new RepositoryDiscovery(this.runner);
    this.operations = new OperationStateReader(this.runner);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  public async discover(cwd: string): Promise<RepositoryInfo> {
    return this.discovery.discover(cwd);
  }

  public async readSnapshot(cwd: string, commitLimit: number, includeReflog = true): Promise<RepositorySnapshot> {
    const repository = await this.discover(cwd);
    const [commits, refs, worktrees, operations, shallowBoundaryOids] = await Promise.all([
      this.readCommits(repository.root, commitLimit),
      this.readRefs(repository.root),
      this.readWorktrees(repository),
      this.operations.read(repository),
      this.readShallowBoundaries(repository),
    ]);
    const visibleCommitCount = Math.min(commitLimit, commits.length);
    const hasMore = commits.length >= commitLimit;
    const reflogs = includeReflog ? await this.readReflogs(repository.root, refs) : [];
    const known = new Map(commits.map((commit) => [commit.oid, commit]));
    if (includeReflog) {
      const reflogOids = [...new Set(reflogs.flatMap((entry) => [entry.newOid, entry.previousOid]).filter((oid): oid is string => Boolean(oid)))];
      const missing = reflogOids.filter((oid) => !known.has(oid));
      const extra = await this.readCommitObjects(repository.root, missing);
      const added = new Set<string>();
      for (const commit of extra) {
        if (known.has(commit.oid) || added.has(commit.oid)) continue;
        added.add(commit.oid);
        commits.push(commit);
      }
    }
    const historyEvents = includeReflog ? resolveHistoryEvents(reflogs, commits) : [];
    return {
      repository,
      commits,
      refs,
      workingTrees: worktrees,
      operations,
      reflogs,
      historyEvents,
      shallowBoundaryOids,
      hasMore,
      visibleCommitCount,
    };
  }

  public async readCommitDetail(root: string, oid: string): Promise<GitCommitDetail> {
    if (!/^[0-9a-f]{7,64}$/i.test(oid)) throw new Error('Invalid commit object id');
    const output = await this.runner.runChecked(
      ['show', '-s', `--format=${gitLogFormat(true)}`, oid],
      { cwd: root, timeoutMs: this.timeoutMs },
    );
    const commit = parseGitLogNul(output)[0];
    if (!commit) throw new GitCommandError(`Unable to parse commit ${oid}`, ['show', oid]);
    const filesOutput = await this.readCommitDiff(root, '--name-status', oid);
    const fileChanges = parseNameStatus(filesOutput);
    let stats: ReturnType<typeof parseNumstat> = [];
    try {
      const statsOutput = await this.readCommitDiff(root, '--numstat', oid);
      stats = parseNumstat(statsOutput);
    } catch {
      // Some object types (for example a root/merge with no diff) do not expose numstat.
    }
    const changes = fileChanges.map((change, index) => ({ ...change, ...stats[index] }));
    const { additions, deletions } = sumNumstat(stats);
    return { ...commit, files: changes.map((change) => change.path), fileChanges: changes, changedFiles: changes.length, additions, deletions };
  }

  private async readCommits(root: string, limit: number): Promise<GitCommit[]> {
    try {
      const baseArgs = ['log', '--all', '--topo-order', '--date-order', '--no-decorate', '-n', String(Math.max(1, limit)), '--numstat'];
      let output: string;
      try {
        output = await this.runner.runChecked([...baseArgs, '--diff-merges=first-parent', `--format=${gitLogNumstatFormat()}`], { cwd: root, timeoutMs: this.timeoutMs });
      } catch (error) {
        if (!isUnsupportedDiffMergeOption(error)) throw error;
        output = await this.runner.runChecked([...baseArgs, `--format=${gitLogNumstatFormat()}`], { cwd: root, timeoutMs: this.timeoutMs });
      }
      return parseGitLogNumstat(output);
    } catch (error) {
      if (error instanceof GitCommandError && /does not have any commits|bad default revision|ambiguous argument/i.test(error.stderr)) return [];
      throw error;
    }
  }

  private async readCommitDiff(root: string, format: '--name-status' | '--numstat', oid: string): Promise<string> {
    const baseArgs = ['diff-tree', '--root', '--no-commit-id', format, '-r', '-M', '-C'];
    try {
      return await this.runner.runChecked([...baseArgs, '--diff-merges=first-parent', oid], { cwd: root, timeoutMs: this.timeoutMs });
    } catch (error) {
      if (!isUnsupportedDiffMergeOption(error)) throw error;
      return this.runner.runChecked([...baseArgs, oid], { cwd: root, timeoutMs: this.timeoutMs });
    }
  }

  private async readCommitObjects(root: string, oids: string[]): Promise<GitCommit[]> {
    const commits: GitCommit[] = [];
    const pending = [...oids];
    const seen = new Set<string>();
    while (pending.length && commits.length < 500) {
      const oid = pending.shift() as string;
      if (seen.has(oid) || !/^[0-9a-f]{7,64}$/i.test(oid)) continue;
      seen.add(oid);
      try {
        const output = await this.runner.runChecked(['show', '-s', `--format=${gitLogFormat(false)}`, oid], {
          cwd: root,
          timeoutMs: this.timeoutMs,
        });
        const commit = parseGitLogNul(output)[0];
        if (commit) {
          commits.push(commit);
          for (const parent of commit.parentOids) if (!seen.has(parent)) pending.push(parent);
        }
      } catch {
        // A reflog can outlive the object. Missing objects are intentionally not modelled.
      }
    }
    return commits;
  }

  private async readRefs(root: string): Promise<GitRef[]> {
    const output = await this.runner.runChecked(['for-each-ref', '--sort=refname', `--format=${refFormat}`], {
      cwd: root,
      timeoutMs: this.timeoutMs,
    });
    const refs = parseRefRecords(output);
    for (const pseudo of ['ORIG_HEAD', 'AUTO_MERGE']) {
      try {
        const oid = (await this.runner.runChecked(['rev-parse', '--verify', pseudo], { cwd: root, timeoutMs: 5000 })).trim();
        if (/^[0-9a-f]{7,64}$/i.test(oid)) refs.push({ fullName: pseudo, shortName: pseudo, type: 'symbolic', oid });
      } catch {
        // Pseudo refs only exist during or after particular Git operations.
      }
    }
    for (const symbolic of refs.filter((ref) => ref.type === 'symbolic' && ref.targetRef)) {
      const target = refs.find((ref) => ref.fullName === symbolic.targetRef || ref.shortName === symbolic.targetRef);
      if (target) target.isDefault = true;
    }
    return refs;
  }

  private async readWorktrees(repository: RepositoryInfo): Promise<WorkingTreeState[]> {
    let parsed: ParsedWorktree[] = [{ path: repository.root, headOid: undefined, branch: undefined, detached: false }];
    try {
      const output = await this.runner.runChecked(['worktree', 'list', '--porcelain'], {
        cwd: repository.root,
        timeoutMs: this.timeoutMs,
      });
      parsed = parseWorktreePorcelain(output);
    } catch {
      // Bare or old Git installations may not provide worktree metadata.
    }
    const states: WorkingTreeState[] = [];
    for (const [index, worktree] of parsed.entries()) {
      try {
        const output = await this.runner.runChecked(['status', '--porcelain=v2', '--branch', '-z'], {
          cwd: worktree.path,
          timeoutMs: this.timeoutMs,
        });
        const state = toWorkingTreeState(worktree.path, parsePorcelainV2(output), `worktree-${index}`);
        const stats = await this.readWorkingTreeStats(worktree.path);
        states.push({ ...state, ...stats, headOid: state.headOid ?? worktree.headOid, branch: state.branch ?? worktree.branch, mainWorktree: index === 0, locked: worktree.locked, prunable: worktree.prunable });
      } catch {
        states.push({
          worktreeId: `worktree-${index}`,
          path: worktree.path,
          headOid: worktree.headOid,
          branch: worktree.branch,
          detached: worktree.detached,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          changedFiles: 0,
          additions: 0,
          deletions: 0,
          clean: true,
          inaccessible: true,
          mainWorktree: index === 0,
          locked: worktree.locked,
          prunable: worktree.prunable,
        });
      }
    }
    return states.length ? states : [{
      worktreeId: 'worktree-0', path: repository.root, detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, changedFiles: 0, additions: 0, deletions: 0, clean: true, mainWorktree: true,
    }];
  }

  private async readWorkingTreeStats(root: string): Promise<{ additions: number; deletions: number }> {
    try {
      const output = await this.runner.runChecked(['diff', '--numstat', 'HEAD'], { cwd: root, timeoutMs: this.timeoutMs });
      return sumNumstat(parseNumstat(output));
    } catch {
      // An unborn HEAD has no revision to compare against; staged changes can
      // still be measured independently.
      try {
        const output = await this.runner.runChecked(['diff', '--cached', '--numstat'], { cwd: root, timeoutMs: this.timeoutMs });
        return sumNumstat(parseNumstat(output));
      } catch {
        return { additions: 0, deletions: 0 };
      }
    }
  }

  private async readReflogs(root: string, refs: GitRef[]): Promise<ReflogEntry[]> {
    const names = [
      'HEAD',
      ...refs.filter((ref) => ref.type === 'local' || ref.type === 'remote').map((ref) => ref.fullName),
      ...refs.filter((ref) => ref.fullName === 'ORIG_HEAD' || ref.fullName === 'AUTO_MERGE').map((ref) => ref.fullName),
    ];
    const all: ReflogEntry[] = [];
    for (const refName of [...new Set(names)]) {
      try {
        const output = await this.runner.runChecked(['reflog', 'show', '--format=' + reflogFormat, refName], {
          cwd: root,
          timeoutMs: this.timeoutMs,
        });
        all.push(...parseReflogRecords(output, refName));
      } catch {
        // Reflogs are optional and commonly absent for remote refs.
      }
    }
    const seen = new Set<string>();
    return all.filter((entry) => {
      const key = `${entry.refName}\0${entry.selector}\0${entry.newOid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async readShallowBoundaries(repository: RepositoryInfo): Promise<string[]> {
    if (!repository.shallow) return [];
    try {
      const shallowPathValue = await this.runner.runChecked(['rev-parse', '--git-path', 'shallow'], {
        cwd: repository.root,
        timeoutMs: 5000,
      });
      const shallowPath = path.isAbsolute(shallowPathValue.trim()) ? shallowPathValue.trim() : path.resolve(repository.root, shallowPathValue.trim());
      const content = await fs.readFile(shallowPath, 'utf8');
      return content.split(/\r?\n/).filter((oid) => /^[0-9a-f]{7,64}$/i.test(oid));
    } catch {
      return [];
    }
  }
}
