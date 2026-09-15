import type { GitCommit, HistoryEvent, ReflogEntry } from '../git/gitTypes.js';
import { branchCommitOrigins } from './branchProtection.js';

/** A proven branch intake, separate from commit parents and current ref positions. */
export interface BranchIntegration {
  eventId: string;
  sourceRef: string;
  targetRef: string;
  beforeOid: string;
  tipOid: string;
  importedOids: string[];
  evidence: 'reflog';
}

export function branchIntegrations(events: HistoryEvent[], commits: GitCommit[], logs: ReflogEntry[]): BranchIntegration[] {
  const byOid = new Map(commits.map(c => [c.oid, c]));
  const origins = branchCommitOrigins(logs, commits);
  return events.flatMap(event => {
    // Pull/fetch synchronization and unnamed ref moves are not separate-branch intake.
    const match = /^merge (\S+): Fast-forward$/i.exec(event.rawReflogMessage ?? '');
    if (event.type !== 'fast-forward' || !event.fromOid || !match || !event.refName.startsWith('refs/heads/')) return [];
    const name = match[1];
    if (/[~^:?*\[\s]|\.\.|@\{|\\/.test(name) || name === 'HEAD' || /^[0-9a-f]{7,64}$/i.test(name)
      || (name.startsWith('refs/') && !name.startsWith('refs/heads/'))) return [];
    const sourceRef = name.startsWith('refs/heads/') ? name : `refs/heads/${name}`;
    if (sourceRef === event.refName || !byOid.has(event.fromOid)) return [];
    if (!logs.some(log => log.refName === event.refName && log.previousOid === event.fromOid
      && log.newOid === event.toOid && log.subject === event.rawReflogMessage)) return [];
    const importedOids: string[] = [];
    let oid = event.toOid;
    // Conservative scope: a complete linear imported range, with unique creation
    // evidence on the explicitly named source. Missing/ambiguous evidence declines
    // this intake only; existing independent route protection is left untouched.
    while (oid !== event.fromOid) {
      const commit = byOid.get(oid);
      if (!commit || commit.parentOids.length !== 1 || importedOids.includes(oid) || origins.get(oid) !== sourceRef) return [];
      importedOids.push(oid); oid = commit.parentOids[0];
    }
    return importedOids.length ? [{ eventId: event.id, sourceRef, targetRef: event.refName,
      beforeOid: event.fromOid, tipOid: event.toOid, importedOids, evidence: 'reflog' as const }] : [];
  });
}
