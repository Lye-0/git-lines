import fs from 'node:fs/promises';
import path from 'node:path';
import { RepositoryDiscovery } from '../repository/repositoryDiscovery.js';
import { GitCommandError, GitRunner } from './gitRunner.js';
import type { ObjectReader } from './objectReader.js';
import { parseCommitObject } from './parsers/commitObjectParser.js';
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
import { sharedTipRouteAnchors } from '../model/sharedTipRouteContinuity.js';
import { branchCommitOrigins } from '../model/branchProtection.js';

export interface GitClientOptions {
  runner?: GitRunner;
  timeoutMs?: number;
  onTiming?: (stage: string, ms: number) => void;
  onCommand?: (command: string, ms: number, bytes: number, ok: boolean) => void;
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
  private readonly onTiming?: GitClientOptions['onTiming'];
  private pageCache?: { key: string; commits: GitCommit[]; tips: string[] };
  private readonly objectCache = new Map<string, GitCommit>();
  private objectContext?: string;
  private readonly reflogCache = new Map<string, { stamp: string; entries: ReflogEntry[] }>();

  public clearCache(): void {
    this.pageCache = undefined;
    this.objectCache.clear();
    this.objectContext = undefined;
    this.reflogCache.clear();
  }

  private async timed<T>(stage: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await action(); }
    finally { this.onTiming?.(stage, performance.now() - started); }
  }

  public constructor(options: GitClientOptions = {}) {
    this.runner = options.runner ?? new GitRunner('git', options.onCommand);
    this.onTiming = options.onTiming;
    this.discovery = new RepositoryDiscovery(this.runner);
    this.operations = new OperationStateReader(this.runner);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  public async discover(cwd: string): Promise<RepositoryInfo> {
    return this.discovery.discover(cwd);
  }

  public async readSnapshot(cwd: string, commitLimit: number, includeReflog = true): Promise<RepositorySnapshot> {
    const repository = await this.timed('discover', () => this.discover(cwd));
    const previousPage = this.pageCache;
    const skip = previousPage?.commits.length ?? 0;
    const [prefetchedCommits, refs, worktrees, operations, shallowBoundaryOids] = await Promise.all([
      // Read the candidate next page alongside state validation. If refs or
      // HEAD moved, discard it and restart at the current tip below.
      skip < commitLimit ? this.timed('commits-prefetch', () => this.readCommits(repository.root, commitLimit - skip, skip, previousPage?.tips)) : Promise.resolve(undefined),
      this.timed('refs', () => this.readRefs(repository.root)),
      this.timed('worktrees', () => this.readWorktrees(repository)),
      this.timed('operations', () => this.operations.read(repository)),
      this.timed('shallow', () => this.readShallowBoundaries(repository)),
    ]);
    const key = JSON.stringify([repository, refs, worktrees.map((tree) => [tree.path, tree.headOid]), shallowBoundaryOids]);
    if (this.objectContext !== key) {
      this.objectCache.clear();
      this.objectContext = key;
    }
    const [commits, reflogs] = await Promise.all([
      this.timed('commits', async () => {
        const cached = previousPage?.key === key ? previousPage.commits : [];
        const extra = previousPage && previousPage.key !== key
          ? await this.readCommits(repository.root, commitLimit)
          : prefetchedCommits ?? [];
        const combined = [...cached, ...extra];
        // Bound retained page data; very large views can still be loaded normally.
        const head = worktrees.find((tree) => tree.currentWorktree === true || tree.path === repository.root)?.headOid;
        const tips = [...new Set([...refs.filter((ref) => ref.fullName.startsWith('refs/')).map((ref) => ref.oid), head].filter((oid): oid is string => Boolean(oid)))];
        this.pageCache = combined.length <= 2000 && tips.length <= 64 ? { key, commits: structuredClone(combined), tips } : undefined;
        return structuredClone(combined.slice(0, commitLimit));
      }),
      includeReflog ? this.timed('reflogs', () => this.readReflogs(repository, refs)) : Promise.resolve([] as ReflogEntry[]),
    ]);
    const visibleCommitCount = Math.min(commitLimit, commits.length);
    const hasMore = commits.length >= commitLimit;
    const known = new Map(commits.map((commit) => [commit.oid, commit]));
    if (includeReflog) {
      const reflogOids = [...new Set(reflogs.flatMap((entry) => [entry.newOid, entry.previousOid]).filter((oid): oid is string => Boolean(oid)))];
      const missing = reflogOids.filter((oid) => !known.has(oid));
      const extra = await this.timed('evidence', () => this.readCommitObjects(repository.root, missing, known));
      const added = new Set<string>();
      for (const commit of extra) {
        if (known.has(commit.oid) || added.has(commit.oid)) continue;
        added.add(commit.oid);
        commits.push(commit);
      }
    }
    let historyEvents = includeReflog ? await this.timed('history-events', async () => resolveHistoryEvents(reflogs, commits)) : [];
    if (includeReflog && historyEvents.length) {
      const operationCommitOids = [...new Set(historyEvents
        .filter((event) => event.type === 'cherry-pick' || event.type === 'revert')
        .map((event) => event.toOid))];
      const bodies = await this.timed('commit-bodies', () => this.readCommitBodies(repository.root, operationCommitOids));
      if (bodies.size) {
        for (const commit of commits) {
          const body = bodies.get(commit.oid);
          if (body !== undefined) commit.body = body;
        }
        historyEvents = await this.timed('history-events-with-bodies', async () => resolveHistoryEvents(reflogs, commits));
      }
    }
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

  /** Fixed placement needs creation evidence even when historical display is
   * disabled. Do not expand commit history or resolve operation objects here. */
  public async readBranchProtection(snapshot: RepositorySnapshot): Promise<ReflogEntry[]> {
    const entries = snapshot.reflogs.length ? snapshot.reflogs : await this.readReflogs(snapshot.repository, snapshot.refs);
    const others = snapshot.workingTrees.filter((tree) => !tree.inaccessible && tree.currentWorktree !== true && tree.path !== snapshot.repository.root);
    const extra: ReflogEntry[][] = new Array(others.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, others.length) }, async () => {
      while (next < others.length) {
        const index = next++, tree = others[index];
        try {
          const output = await this.runner.runChecked(['reflog', 'show', '--format=' + reflogFormat, 'HEAD'], { cwd: tree.path, timeoutMs: this.timeoutMs });
          extra[index] = parseReflogRecords(output, `worktree:${tree.worktreeId}/HEAD`);
        } catch { extra[index] = []; }
      }
    }));
    return [...entries, ...extra.flat()];
  }

  /** Bounded route metadata only; never expands the visible graph page. */
  public async readRouteContinuityEvidence(snapshot: RepositorySnapshot, logs: ReflogEntry[]): Promise<GitCommit[]> {
    const known = new Map(snapshot.commits.map((c) => [c.oid, c]));
    let origins = branchCommitOrigins(logs, snapshot.commits);
    let reader: ObjectReader | undefined;
    let remaining = 64;
    const getReader = () => reader ??= this.runner.openObjectReader({ cwd: snapshot.repository.root, timeoutMs: this.timeoutMs });
    try {
      // Reflog OFF snapshots may not contain even the proven earlier tip.
      // Fetch only these candidate anchors, within the same object budget.
      const local = snapshot.refs.filter((ref) => ref.type === 'local' && ref.oid);
      for (const ref of local) {
        if (origins.has(ref.oid!) || !local.some((other) => other.fullName !== ref.fullName && other.oid === ref.oid)) continue;
        const previous = logs.find((entry) => entry.refName === ref.fullName && /@\{0\}$/.test(entry.selector) && entry.newOid === ref.oid)?.previousOid;
        if (!previous || previous === ref.oid || known.has(previous)) continue;
        if (remaining-- <= 0) break;
        const [commit] = await this.readCommitObjectBatch(snapshot.repository.root, [previous], getReader);
        if (commit) known.set(commit.oid, commit);
      }
      origins = branchCommitOrigins(logs, [...known.values()]);
      for (const { tip, anchor, refName } of sharedTipRouteAnchors([...known.values()], snapshot.refs, logs)) {
        // Directly-created shared tips already have stronger ownership evidence.
        if (origins.has(tip)) continue;
        let current: string | undefined = tip;
        const visited = new Set<string>();
        while (current && current !== anchor && visited.size < 256 && !visited.has(current)) {
          visited.add(current);
          if (origins.has(current) && origins.get(current) !== refName) break;
          if (!known.has(current)) {
            if (remaining-- <= 0) break;
            const [commit] = await this.readCommitObjectBatch(snapshot.repository.root, [current], getReader);
            if (!commit) break;
            known.set(commit.oid, commit);
          }
          current = known.get(current)?.parentOids[0];
        }
      }
    } finally { await reader?.close(); }
    return [...known.values()];
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

  private async readCommits(root: string, limit: number, skip = 0, tips?: string[]): Promise<GitCommit[]> {
    try {
      // `--all` does not include a detached HEAD that is not reachable from a
      // named ref.  Add HEAD explicitly so a newly-created detached commit is
      // still available to the graph as the current live state.
      const baseArgs = ['log', ...(tips?.length ? tips : ['--all', 'HEAD']), '--topo-order', '--date-order', '--no-decorate', '-n', String(Math.max(1, limit)), '--numstat'];
      if (skip) baseArgs.push(`--skip=${skip}`);
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

  private async readCommitObjects(root: string, oids: string[], known: Map<string, GitCommit>): Promise<GitCommit[]> {
    const commits: GitCommit[] = [];
    const pending = [...oids];
    const seen = new Set<string>();
    let reader: ObjectReader | undefined;
    const getReader = () => reader ??= this.runner.openObjectReader({ cwd: root, timeoutMs: this.timeoutMs });
    try {
      while (pending.length && commits.length < 500) {
        // Bound outstanding object requests and preserve the existing breadth-first walk.
        const batch: string[] = [];
        const batchLimit = Math.min(64, 500 - commits.length);
        while (pending.length && batch.length < batchLimit) {
          const oid = pending.shift() as string;
          if (seen.has(oid) || !/^[0-9a-f]{7,64}$/i.test(oid)) continue;
          seen.add(oid);
          const existing = known.get(oid);
          if (existing) {
            for (const parent of existing.parentOids) if (!seen.has(parent)) pending.push(parent);
            continue;
          }
          batch.push(oid);
        }
        for (const commit of await this.readCommitObjectBatch(root, batch, getReader)) {
          commits.push(commit);
          for (const parent of commit.parentOids) if (!seen.has(parent)) pending.push(parent);
        }
      }
      return commits;
    } finally { await reader?.close(); }
  }

  private async readCommitObjectBatch(root: string, oids: string[], getReader: () => ObjectReader): Promise<GitCommit[]> {
    const results = await Promise.all(oids.map(async (oid) => {
      const key = root + ':' + oid;
      const cached = this.objectCache.get(key);
      if (cached) return structuredClone(cached);
      try {
        const object = await getReader().read(oid);
        let commit: GitCommit | undefined;
        try { commit = object && parseCommitObject(object); }
        catch {
          // Git's iconv support may exceed TextDecoder's legacy encodings.
          const output = await this.runner.runChecked(['show', '-s', `--format=${gitLogFormat(false)}`, oid], { cwd: root, timeoutMs: this.timeoutMs });
          commit = parseGitLogNul(output)[0];
        }
        if (commit) {
          this.objectCache.set(key, structuredClone(commit));
          if (this.objectCache.size > 2000) this.objectCache.delete(this.objectCache.keys().next().value!);
        }
        return commit;
      } catch {
        // Missing objects are individual responses; a process failure must
        // not multiply retries or discard already completed valid responses.
        return undefined;
      }
    }));
    return results.filter((commit): commit is GitCommit => commit !== undefined);
  }

  private async readCommitBodies(root: string, oids: string[]): Promise<Map<string, string>> {
    const validOids = [...new Set(oids)].filter((oid) => /^[0-9a-f]{7,64}$/i.test(oid));
    if (!validOids.length) return new Map();
    try {
      const output = await this.runner.runChecked(['show', '-s', `--format=${gitLogFormat(true)}`, ...validOids], {
        cwd: root,
        timeoutMs: this.timeoutMs,
      });
      return new Map(parseGitLogNul(output)
        .filter((commit): commit is GitCommit & { body: string } => commit.body !== undefined)
        .map((commit) => [commit.oid, commit.body]));
    } catch {
      // Event detection must remain available when an object body cannot be
      // loaded; source/target evidence is optional and never inferred.
      return new Map();
    }
  }

  public async readRefs(root: string): Promise<GitRef[]> {
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
    const repositoryRoot = path.normalize(repository.root).toLocaleLowerCase();
    const hasCurrentPath = parsed.some((worktree) => path.normalize(worktree.path).toLocaleLowerCase() === repositoryRoot);
    const states: WorkingTreeState[] = [];
    for (const [index, worktree] of parsed.entries()) {
      const currentWorktree = path.normalize(worktree.path).toLocaleLowerCase() === repositoryRoot
        || (!hasCurrentPath && index === 0);
      try {
        const output = await this.runner.runChecked(['status', '--porcelain=v2', '--branch', '-z'], {
          cwd: worktree.path,
          timeoutMs: this.timeoutMs,
        });
        const state = toWorkingTreeState(worktree.path, parsePorcelainV2(output), `worktree-${index}`);
        const stats = await this.readWorkingTreeStats(worktree.path);
        states.push({ ...state, ...stats, headOid: state.headOid ?? worktree.headOid, branch: state.branch ?? worktree.branch, currentWorktree, mainWorktree: index === 0, locked: worktree.locked, prunable: worktree.prunable });
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
          currentWorktree,
          mainWorktree: index === 0,
          locked: worktree.locked,
          prunable: worktree.prunable,
        });
      }
    }
    return states.length ? states : [{
      worktreeId: 'worktree-0', path: repository.root, detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, changedFiles: 0, additions: 0, deletions: 0, clean: true, currentWorktree: true, mainWorktree: true,
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

  private async readReflogs(repository: RepositoryInfo, refs: GitRef[]): Promise<ReflogEntry[]> {
    const root = repository.root;
    const names = [
      'HEAD',
      ...refs.filter((ref) => ref.type === 'local' || ref.type === 'remote').map((ref) => ref.fullName),
      ...refs.filter((ref) => ref.fullName === 'ORIG_HEAD' || ref.fullName === 'AUTO_MERGE').map((ref) => ref.fullName),
    ];
    const readRef = async (refName: string): Promise<ReflogEntry[]> => {
      try {
        const logPath = path.join(refName === 'HEAD' ? repository.gitDir : repository.commonGitDir, 'logs', refName);
        const stamp = await fs.stat(logPath).then((stat) => `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`, () => undefined);
        const cached = this.reflogCache.get(logPath);
        if (stamp !== undefined && cached?.stamp === stamp) {
          return structuredClone(cached.entries);
        }
        const output = await this.runner.runChecked(['reflog', 'show', '--format=' + reflogFormat, refName], {
          cwd: root,
          timeoutMs: this.timeoutMs,
        });
        const entries = parseReflogRecords(output, refName);
        if (stamp !== undefined && entries.length <= 20000) this.reflogCache.set(logPath, { stamp, entries: structuredClone(entries) });
        while (this.reflogCache.size > 256 || [...this.reflogCache.values()].reduce((sum, value) => sum + value.entries.length, 0) > 20000) {
          this.reflogCache.delete(this.reflogCache.keys().next().value!);
        }
        return entries;
      } catch {
        // Reflogs are optional and commonly absent for remote refs.
        return [];
      }
    };
    const uniqueNames = [...new Set(names)];
    const results: ReflogEntry[][] = new Array(uniqueNames.length);
    let nextIndex = 0;
    // Bound Git processes on Windows. Preserve ref order independently of
    // completion order, since history classification uses deterministic input.
    await Promise.all(Array.from({ length: Math.min(4, uniqueNames.length) }, async () => {
      while (nextIndex < uniqueNames.length) {
        const index = nextIndex++;
        results[index] = await readRef(uniqueNames[index]);
      }
    }));
    const all = results.flat();
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
