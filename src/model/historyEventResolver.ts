import type { GitCommit, HistoryEvent, HistoryEventType, ReflogEntry } from '../git/gitTypes.js';

interface ClassifiedEntry {
  entry: ReflogEntry;
  type: HistoryEventType;
}

interface EventGroup {
  type: HistoryEventType;
  fromOid?: string;
  toOid: string;
  timestamp: number;
  entries: ReflogEntry[];
}

function isExplicitFastForward(subject: string): boolean {
  // Git uses these subjects for merge/pull operations. A fetch also commonly
  // says "fast-forward", but that is a routine remote-tracking update and is
  // intentionally not promoted to a user-facing merge event.
  const trimmed = subject.trim();
  return /^(?:merge|pull)\b[^\n]*:\s*fast-forward\b/i.test(trimmed)
    // Some Git integrations emit an explicit, operation-less
    // "Fast-forward" reflog subject.  It is still safe to classify because
    // ancestry and the destination's single-parent shape are checked below.
    || /^fast-forward(?:\b|:)/i.test(trimmed);
}

function operationName(subject: string): string | undefined {
  const match = /^(pull|merge)\b/i.exec(subject.trim());
  return match?.[1]?.toLowerCase();
}

function isExplicitReset(subject: string): boolean {
  return /^(?:reset|reset\s+--\w+)(?::|\s|$)/i.test(subject.trim());
}

function isExplicitAmend(subject: string): boolean {
  const trimmed = subject.trim();
  return /^commit\s*\(amend\):/i.test(trimmed) || /^commit\s+--amend(?:\s|:|$)/i.test(trimmed);
}

function isExplicitRebase(subject: string): boolean {
  return /^rebase(?:\s|\(|:|$)/i.test(subject.trim());
}

function isCompletedRebase(subject: string, refName: string): boolean {
  // A completed rebase writes the authoritative old-tip -> new-tip movement
  // to the rebased local branch.  HEAD also receives start/continue/finish
  // entries while Git replays commits; those are implementation details and
  // must not become separate user-facing events.
  return refName.startsWith('refs/heads/')
    && /^rebase\s+\(finish\):\s+refs\/heads\/\S+(?:\s|$)/i.test(subject.trim());
}

function isExplicitForceUpdate(subject: string): boolean {
  const trimmed = subject.trim();
  return !/^commit\b/i.test(trimmed) && /\bforced?[- ]update\b|\bforce[- ]update\b/i.test(trimmed);
}

function isExplicitBranchMove(subject: string): boolean {
  // `branch -f` and the corresponding reflog wording are meaningful; normal
  // checkout/switch and branch creation entries are routine navigation.
  return /^(?:branch\s+-f\b|branch:\s*(?:reset|force|move)\b)/i.test(subject.trim());
}

function classify(subject: string, fromOid: string | undefined, toOid: string, refName: string, commits: Map<string, GitCommit>): HistoryEventType | undefined {
  // A fast-forward updates a ref to an existing single-parent descendant; a
  // two-parent merge commit is never itself a fast-forward event even if its
  // first-parent ancestry happens to contain the previous ref tip.
  if (isExplicitFastForward(subject) && fromOid && commits.get(toOid)?.parentOids.length === 1 && isAncestor(fromOid, toOid, commits)) return 'fast-forward';
  if (isExplicitReset(subject)) return 'reset';
  if (isExplicitAmend(subject)) return 'amend';
  if (isExplicitRebase(subject) && isCompletedRebase(subject, refName)) return 'rebase';
  if (isExplicitForceUpdate(subject)) return 'force-update';
  if (isExplicitBranchMove(subject) && refName.startsWith('refs/heads/')) return 'branch-move';
  return undefined;
}

function isAncestor(ancestor: string, descendant: string, commits: Map<string, GitCommit>): boolean {
  if (ancestor === descendant) return false;
  const queue = [descendant];
  const seen = new Set<string>();
  while (queue.length) {
    const oid = queue.shift() as string;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const commit = commits.get(oid);
    if (!commit) continue;
    for (const parent of commit.parentOids) {
      if (parent === ancestor) return true;
      queue.push(parent);
    }
  }
  return false;
}

/**
 * Counts the commits in the equivalent of `git rev-list old..new`.
 *
 * Both reachable sets are walked explicitly.  Stopping only at the old tip
 * is not sufficient for a merge-shaped history: a side parent can point into
 * an ancestor of the old tip without visiting the old OID itself.  An
 * incomplete object graph returns undefined instead of presenting a guess.
 */
export function countCommitsBetween(fromOid: string | undefined, toOid: string, commits: Iterable<GitCommit>): number | undefined {
  if (!fromOid) return undefined;
  if (fromOid === toOid) return 0;
  const commitMap = new Map([...commits].map((commit) => [commit.oid, commit]));
  if (!commitMap.has(toOid) || !commitMap.has(fromOid)) return undefined;
  let complete = true;
  const collectReachable = (start: string): Set<string> => {
    const reachable = new Set<string>();
    const queue = [start];
    let index = 0;
    while (index < queue.length) {
      const oid = queue[index++];
      if (reachable.has(oid)) continue;
      reachable.add(oid);
      const commit = commitMap.get(oid);
      if (!commit) {
        complete = false;
        continue;
      }
      queue.push(...commit.parentOids);
    }
    return reachable;
  };
  const oldReachable = collectReachable(fromOid);
  const newReachable = collectReachable(toOid);
  let count = 0;
  for (const oid of newReachable) if (!oldReachable.has(oid)) count += 1;
  return complete ? count : undefined;
}

function sourceLabel(subject: string): string | undefined {
  const match = /^(?:merge|pull)\s+(.+?):\s*fast-forward\b/i.exec(subject.trim());
  if (!match?.[1]) return undefined;
  const tokens = match[1].trim().split(/\s+/).filter((token) => !token.startsWith('--'));
  return tokens.at(-1) || undefined;
}

function refPriority(refName: string): number {
  if (refName.startsWith('refs/heads/')) return 0;
  if (refName === 'HEAD') return 1;
  if (refName.startsWith('refs/remotes/')) return 2;
  return 3;
}

function groupKey(entry: ClassifiedEntry): string {
  // The same operation can write different subjects (or cross a timestamp
  // boundary) for HEAD, a local branch, and a remote-tracking ref. The
  // proven operation type and OID transition are the stable identity we have.
  return [entry.type, entry.entry.previousOid ?? '', entry.entry.newOid].join('\0');
}

function firstRef(group: EventGroup): string {
  return group.entries.slice().sort((a, b) => refPriority(a.refName) - refPriority(b.refName) || a.refName.localeCompare(b.refName))[0].refName;
}

function bestSubject(entries: ReflogEntry[]): ReflogEntry {
  return entries.slice().sort((a, b) => {
    const aExplicit = /^(?:merge|pull)\b[^\n]*:\s*fast-forward\b/i.test(a.subject.trim()) ? 0 : 1;
    const bExplicit = /^(?:merge|pull)\b[^\n]*:\s*fast-forward\b/i.test(b.subject.trim()) ? 0 : 1;
    return aExplicit - bExplicit || refPriority(a.refName) - refPriority(b.refName) || a.refName.localeCompare(b.refName);
  })[0];
}

/**
 * Resolves only meaningful, Git-proven ref movements and coalesces the
 * duplicate HEAD/local/remote entries emitted by one operation.
 */
export function resolveHistoryEvents(entries: ReflogEntry[], commits: GitCommit[]): HistoryEvent[] {
  const commitMap = new Map(commits.map((commit) => [commit.oid, commit]));
  const candidates: ClassifiedEntry[] = [];
  for (const entry of entries) {
    if (!entry.previousOid || entry.previousOid === entry.newOid) continue;
    const type = classify(entry.subject, entry.previousOid, entry.newOid, entry.refName, commitMap);
    if (type) candidates.push({ entry, type });
  }

  const groups = new Map<string, EventGroup>();
  for (const candidate of candidates) {
    const key = groupKey(candidate);
    const current = groups.get(key);
    if (current) {
      current.entries.push(candidate.entry);
      current.timestamp = Math.max(current.timestamp, candidate.entry.timestamp);
    }
    else groups.set(key, {
      type: candidate.type,
      fromOid: candidate.entry.previousOid,
      toOid: candidate.entry.newOid,
      timestamp: candidate.entry.timestamp,
      entries: [candidate.entry],
    });
  }

  return [...groups.values()]
    .sort((a, b) => b.timestamp - a.timestamp || refPriority(firstRef(a)) - refPriority(firstRef(b)) || firstRef(a).localeCompare(firstRef(b)) || a.toOid.localeCompare(b.toOid))
    .map((group) => {
      const entriesForGroup = group.entries.slice().sort((a, b) => refPriority(a.refName) - refPriority(b.refName) || a.refName.localeCompare(b.refName));
      const representative = bestSubject(entriesForGroup);
      const affectedRefs = [...new Set(entriesForGroup.map((entry) => entry.refName))];
      return {
        id: `history:${group.type}:${group.timestamp}:${group.toOid}`,
        type: group.type,
        refName: entriesForGroup[0].refName,
        fromOid: group.fromOid,
        toOid: group.toOid,
        timestamp: group.timestamp,
        ...(group.type === 'fast-forward' ? { commitCount: countCommitsBetween(group.fromOid, group.toOid, commitMap.values()), operation: operationName(representative.subject) } : {}),
        rawReflogMessage: representative.subject,
        sourceLabel: sourceLabel(representative.subject),
        subject: representative.subject,
        affectedRefs,
      };
    });
}

export function isCommitAncestor(ancestor: string, descendant: string, commits: Iterable<GitCommit>): boolean {
  return isAncestor(ancestor, descendant, new Map([...commits].map((commit) => [commit.oid, commit])));
}
