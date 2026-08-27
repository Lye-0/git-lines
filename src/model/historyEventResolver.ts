import type { GitCommit, HistoryEvent, HistoryEventType, ReflogEntry } from '../git/gitTypes.js';

function classify(subject: string, fromOid: string | undefined, toOid: string, refName: string, commits: Map<string, GitCommit>): HistoryEventType {
  const lower = subject.toLowerCase();
  if (/fast-forward/.test(lower) && fromOid && isAncestor(fromOid, toOid, commits)) return 'fast-forward';
  if (/^reset(?::|\b)/.test(lower) || / reset:/i.test(subject)) return 'reset';
  if (/amend/.test(lower)) return 'amend';
  if (/rebase/.test(lower)) return 'rebase';
  if (/forced update|force-update|forced-update/.test(lower)) return 'force-update';
  if (/branch|checkout/.test(lower) && refName.startsWith('refs/heads/')) return 'branch-move';
  return 'generic-ref-move';
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

function sourceLabel(subject: string): string | undefined {
  const match = /(?:merge|from)\s+([^:]+?)(?::\s*fast-forward|$)/i.exec(subject);
  return match?.[1]?.trim() || undefined;
}

export function resolveHistoryEvents(entries: ReflogEntry[], commits: GitCommit[]): HistoryEvent[] {
  const commitMap = new Map(commits.map((commit) => [commit.oid, commit]));
  return entries
    .filter((entry) => Boolean(entry.previousOid) && entry.previousOid !== entry.newOid)
    .map((entry, index) => ({
      id: `history:${entry.refName}:${entry.timestamp}:${entry.newOid}:${index}`,
      type: classify(entry.subject, entry.previousOid, entry.newOid, entry.refName, commitMap),
      refName: entry.refName,
      fromOid: entry.previousOid,
      toOid: entry.newOid,
      timestamp: entry.timestamp,
      sourceLabel: sourceLabel(entry.subject),
      subject: entry.subject,
    }));
}

export function isCommitAncestor(ancestor: string, descendant: string, commits: Iterable<GitCommit>): boolean {
  return isAncestor(ancestor, descendant, new Map([...commits].map((commit) => [commit.oid, commit])));
}
