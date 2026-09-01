import type { GitCommit, HistoryEvent, HistoryEventType, ReflogEntry } from '../git/gitTypes.js';

interface ClassifiedEntry {
  entry: ReflogEntry;
  type: HistoryEventType;
  branchRename?: BranchRename;
}

interface BranchRename {
  fromRef: string;
  toRef: string;
}

interface EventGroup {
  type: HistoryEventType;
  fromOid?: string;
  toOid: string;
  fromRef?: string;
  toRef?: string;
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

function isCompletedBranchOperation(subject: string, refName: string, operation: 'cherry-pick' | 'revert'): boolean {
  // A completed operation updates the local branch ref. HEAD may also get a
  // reflog entry while Git performs the operation, but that entry is an
  // implementation detail and must not create a second event.
  if (!refName.startsWith('refs/heads/')) return false;
  const trimmed = subject.trim();
  if (operation === 'cherry-pick') {
    // Git records a completed conflicted cherry-pick as the explicit
    // `commit (cherry-pick): ...` reflog action. Keep the shorter form for
    // integrations that expose the action without the commit wrapper.
    return /^(?:cherry-pick(?:\s|\(|:|$)|commit\s+\(cherry-pick\):)/i.test(trimmed);
  }
  // After `revert --continue`, Git 2.x records the branch update as
  // `commit: Revert "..."`; unlike a broad commit-message search, this exact
  // canonical reflog subject is restricted to the reflog action and its
  // generated quoted revert subject. Some integrations expose `revert:` or
  // `commit (revert):` directly, so accept those explicit forms as well.
  return /^(?:revert(?:\s|\(|:|$)|commit\s+\(revert\):|commit:\s+Revert\s+["'])/i.test(trimmed);
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

/**
 * Git records a local branch rename explicitly in both the old HEAD reflog
 * and the new branch reflog.  This is a ref-name operation, not an OID move:
 * the new entry normally has the same OID as the preceding entry.  Keep the
 * parser deliberately strict so a branch name or commit subject can never
 * manufacture a rename event.
 */
function parseExplicitBranchRename(subject: string): BranchRename | undefined {
  const match = /^branch:\s*renamed\s+(refs\/heads\/\S+)\s+to\s+(refs\/heads\/\S+)\s*$/i.exec(subject.trim());
  if (!match?.[1] || !match[2] || match[1] === match[2]) return undefined;
  return { fromRef: match[1], toRef: match[2] };
}

function isBranchRenameRef(entry: ReflogEntry, rename: BranchRename): boolean {
  // The same Git operation is emitted for HEAD and for the resulting local
  // branch.  Other refs are not authoritative evidence for a local rename.
  return entry.refName === 'HEAD' || entry.refName === rename.toRef;
}

function classify(subject: string, fromOid: string | undefined, toOid: string, refName: string, commits: Map<string, GitCommit>): HistoryEventType | undefined {
  // A fast-forward updates a ref to an existing single-parent descendant; a
  // two-parent merge commit is never itself a fast-forward event even if its
  // first-parent ancestry happens to contain the previous ref tip.
  if (isExplicitFastForward(subject) && fromOid && commits.get(toOid)?.parentOids.length === 1 && isAncestor(fromOid, toOid, commits)) return 'fast-forward';
  if (isExplicitReset(subject)) return 'reset';
  if (isExplicitAmend(subject)) return 'amend';
  if (isExplicitRebase(subject) && isCompletedRebase(subject, refName)) return 'rebase';
  if (isCompletedBranchOperation(subject, refName, 'cherry-pick')) return 'cherry-pick';
  if (isCompletedBranchOperation(subject, refName, 'revert')) return 'revert';
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
  if (entry.type === 'branch-rename' && entry.branchRename) {
    return [entry.type, entry.branchRename.fromRef, entry.branchRename.toRef, entry.entry.newOid].join('\0');
  }
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

function resolveKnownOid(value: string | undefined, commits: Map<string, GitCommit>): string | undefined {
  if (!value) return undefined;
  if (commits.has(value)) return value;
  const matches = [...commits.keys()].filter((oid) => oid.startsWith(value));
  return matches.length === 1 ? matches[0] : undefined;
}

function bodyOid(body: string | undefined, pattern: RegExp): string | undefined {
  if (!body) return undefined;
  const match = body.replace(/\r\n?/g, '\n').match(pattern);
  const oid = match?.[1];
  return oid && /^[0-9a-f]{40,64}$/i.test(oid) ? oid : undefined;
}

/**
 * Cherry-pick -x records the source object in the commit body.  This is the
 * only source evidence used here; subjects, patches, and similar changes are
 * intentionally not treated as proof.
 */
function cherryPickSourceOid(body: string | undefined): string | undefined {
  return bodyOid(body, /(?:^|\n)\(cherry picked from commit ([0-9a-f]{40,64})\)[ \t]*(?:\n|$)/i);
}

/** Git's generated Revert commit body contains the exact reverted object. */
function revertTargetOid(body: string | undefined): string | undefined {
  return bodyOid(body, /(?:^|\n)This reverts commit ([0-9a-f]{40,64})\.[ \t]*(?:\n|$)/);
}

function rebaseOntoOid(subject: string, commits: Map<string, GitCommit>): string | undefined {
  // Git's branch reflog finish entry records the exact onto object.  Resolve
  // an abbreviated value only when it identifies one known object.
  const match = /\bonto\s+([0-9a-f]{7,64})\s*$/i.exec(subject.trim());
  return resolveKnownOid(match?.[1], commits);
}

function firstParentCommonAncestor(fromOid: string | undefined, toOid: string, commits: Map<string, GitCommit>): string | undefined {
  if (!fromOid) return undefined;
  const oldPath = new Set<string>();
  const oldVisited = new Set<string>();
  let current: string | undefined = fromOid;
  while (current && !oldVisited.has(current)) {
    oldVisited.add(current);
    const commit = commits.get(current);
    if (!commit) break;
    oldPath.add(current);
    current = commit.parentOids[0];
  }

  const newVisited = new Set<string>();
  current = toOid;
  while (current && !newVisited.has(current)) {
    newVisited.add(current);
    if (oldPath.has(current) && current !== toOid) return current;
    current = commits.get(current)?.parentOids[0];
  }
  return undefined;
}

/**
 * Resolves the row boundary for an operation from the actual commit graph.
 * The destination OID remains the ref movement target; this value is the
 * commit immediately below the newly-created history interval.
 */
function boundaryOidFor(group: EventGroup, representative: ReflogEntry, commits: Map<string, GitCommit>): string | undefined {
  switch (group.type) {
    case 'reset':
      return group.toOid;
    case 'amend':
    case 'cherry-pick':
    case 'revert':
      return commits.get(group.toOid)?.parentOids[0] ?? group.toOid;
    case 'rebase':
      return rebaseOntoOid(representative.subject, commits)
        ?? firstParentCommonAncestor(group.fromOid, group.toOid, commits)
        ?? group.toOid;
    default:
      return undefined;
  }
}

function firstChildAboveBoundary(toOid: string, boundaryOid: string | undefined, commits: Map<string, GitCommit>): string | undefined {
  if (!boundaryOid) return undefined;
  let current: string | undefined = toOid;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === boundaryOid) return current === toOid ? toOid : undefined;
    visited.add(current);
    const parentOid: string | undefined = commits.get(current)?.parentOids[0];
    if (!parentOid) return undefined;
    if (parentOid === boundaryOid) return current;
    current = parentOid;
  }
  return undefined;
}

function eventStartOidFor(group: EventGroup, boundaryOid: string | undefined, commits: Map<string, GitCommit>): string | undefined {
  if (group.type === 'rebase') return firstChildAboveBoundary(group.toOid, boundaryOid, commits) ?? group.toOid;
  if (group.type === 'branch-rename') return group.toOid;
  if (group.type === 'reset' || group.type === 'amend' || group.type === 'cherry-pick' || group.type === 'revert') return group.toOid;
  return undefined;
}

/**
 * Resolves only meaningful, Git-proven ref movements and coalesces the
 * duplicate HEAD/local/remote entries emitted by one operation.
 */
export function resolveHistoryEvents(entries: ReflogEntry[], commits: GitCommit[]): HistoryEvent[] {
  const commitMap = new Map(commits.map((commit) => [commit.oid, commit]));
  const candidates: ClassifiedEntry[] = [];
  for (const entry of entries) {
    const branchRename = parseExplicitBranchRename(entry.subject);
    if (branchRename && isBranchRenameRef(entry, branchRename) && commitMap.has(entry.newOid)) {
      candidates.push({ entry, type: 'branch-rename', branchRename });
      continue;
    }
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
      fromOid: candidate.type === 'branch-rename' ? undefined : candidate.entry.previousOid,
      toOid: candidate.entry.newOid,
      ...(candidate.branchRename ? { fromRef: candidate.branchRename.fromRef, toRef: candidate.branchRename.toRef } : {}),
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
      const boundaryOid = boundaryOidFor(group, representative, commitMap);
      const eventStartOid = eventStartOidFor(group, boundaryOid, commitMap);
      const operationCommit = commitMap.get(group.toOid);
      const sourceOid = group.type === 'cherry-pick' ? cherryPickSourceOid(operationCommit?.body) : undefined;
      const targetOid = group.type === 'revert' ? revertTargetOid(operationCommit?.body) : undefined;
      return {
        id: `history:${group.type}:${group.timestamp}:${group.toOid}`,
        type: group.type,
        refName: group.toRef ?? entriesForGroup[0].refName,
        fromOid: group.fromOid,
        toOid: group.toOid,
        ...(boundaryOid ? { boundaryOid } : {}),
        ...(eventStartOid ? { eventStartOid } : {}),
        timestamp: group.timestamp,
        ...(group.type === 'branch-rename' ? {
          operation: 'Branch rename',
          fromRef: group.fromRef,
          toRef: group.toRef,
        } : {}),
        ...(group.type === 'fast-forward' ? { commitCount: countCommitsBetween(group.fromOid, group.toOid, commitMap.values()), operation: operationName(representative.subject) } : {}),
        ...(sourceOid ? { sourceOid } : {}),
        ...(targetOid ? { targetOid } : {}),
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
