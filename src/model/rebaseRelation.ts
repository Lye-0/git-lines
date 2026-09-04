import type { GitCommit, HistoryEvent, OperationState, ReflogEntry } from '../git/gitTypes.js';
import type { RebaseRelation } from './graphModel.js';

const INTERACTIVE_REBASE = /^rebase\s+\((?:squash|fixup|drop|reword|edit)\)/i;
const REBASE_PICK = /^rebase\s+\(pick\)/i;
const REBASE_START = /^rebase\s+\(start\)/i;
const REBASE_FINISH_RETURNING = /^rebase\s+\(finish\):\s+returning\s+to\s+refs\/heads\//i;

export function parseRebaseOntoOid(subject: string | undefined): string | undefined {
  if (!subject) return undefined;
  const match = /\bonto\s+([0-9a-f]{7,64})\s*$/i.exec(subject.trim());
  return match?.[1];
}

function resolveKnownOid(value: string | undefined, commits: Map<string, GitCommit>): string | undefined {
  if (!value) return undefined;
  if (commits.has(value)) return value;
  const matches = [...commits.keys()].filter((oid) => oid.startsWith(value));
  return matches.length === 1 ? matches[0] : undefined;
}

function reachableFrom(oid: string, commits: Map<string, GitCommit>): Set<string> | undefined {
  const reachable = new Set<string>();
  const queue = [oid];
  let complete = true;
  while (queue.length) {
    const current = queue.shift() as string;
    if (reachable.has(current)) continue;
    const commit = commits.get(current);
    if (!commit) {
      complete = false;
      continue;
    }
    reachable.add(current);
    queue.push(...commit.parentOids);
  }
  return complete ? reachable : undefined;
}

/**
 * First-parent commits from tip down to, but not including, the first commit
 * reachable from `stopReachable`.  Oldest → newest.  Undefined when the walk
 * is incomplete, nonlinear, or empty.
 */
export function exclusiveLinearRange(
  tipOid: string,
  stopReachable: Set<string>,
  commits: Map<string, GitCommit>,
): string[] | undefined {
  if (stopReachable.has(tipOid)) return undefined;
  const newestFirst: string[] = [];
  let current: string | undefined = tipOid;
  const visited = new Set<string>();
  while (current && !visited.has(current) && !stopReachable.has(current)) {
    visited.add(current);
    const commit = commits.get(current);
    if (!commit) return undefined;
    if (commit.parentOids.length !== 1) return undefined;
    newestFirst.push(current);
    current = commit.parentOids[0];
  }
  if (!current || !stopReachable.has(current) || newestFirst.length === 0) return undefined;
  for (let index = 1; index < newestFirst.length; index += 1) {
    const child = commits.get(newestFirst[index - 1]);
    if (child?.parentOids[0] !== newestFirst[index]) return undefined;
  }
  return newestFirst.slice().reverse();
}

function isRebaseSubject(subject: string): boolean {
  return /^rebase(?:\s|\(|:|$)/i.test(subject.trim());
}

function reflogIndex(entry: ReflogEntry): number | undefined {
  const match = /@\{(\d+)\}$/.exec(entry.selector.trim());
  return match ? Number(match[1]) : undefined;
}

interface RebaseSession {
  hasStart: boolean;
  pickCount: number;
  interactive: boolean;
}

/**
 * Collects HEAD rebase entries that belong to the same completed session as
 * the branch `rebase (finish)` event.  A later unrelated operation is not
 * mixed in: walking stops at the first non-rebase HEAD subject.
 */
export function rebaseSessionForEvent(event: HistoryEvent, reflogs: ReflogEntry[]): RebaseSession | undefined {
  const byIndex = new Map<number, ReflogEntry>();
  for (const entry of reflogs) {
    if (entry.refName !== 'HEAD') continue;
    const index = reflogIndex(entry);
    if (index === undefined) continue;
    byIndex.set(index, entry);
  }
  const finish = [...byIndex.values()].find((entry) =>
    REBASE_FINISH_RETURNING.test(entry.subject) && entry.newOid === event.toOid);
  if (!finish) return undefined;
  let index = reflogIndex(finish);
  if (index === undefined) return undefined;
  const session: ReflogEntry[] = [];
  while (true) {
    const entry = byIndex.get(index);
    if (!entry || !isRebaseSubject(entry.subject)) return undefined;
    session.push(entry);
    if (REBASE_START.test(entry.subject)) break;
    index += 1;
    if (session.length > 10_000) return undefined;
  }
  const start = session.find((entry) => REBASE_START.test(entry.subject));
  if (!start) return undefined;
  if (event.boundaryOid && start.newOid !== event.boundaryOid) return undefined;
  return {
    hasStart: true,
    pickCount: session.filter((entry) => REBASE_PICK.test(entry.subject)).length,
    interactive: session.some((entry) => INTERACTIVE_REBASE.test(entry.subject)),
  };
}

export interface RebaseRelationOptions {
  reflogs?: ReflogEntry[];
  operations?: OperationState[];
}

export function isCompleteRebaseOverlay(
  event: HistoryEvent,
  commits: Map<string, GitCommit>,
  options: RebaseRelationOptions = {},
): boolean {
  return buildRebaseRelation(event, commits, options) !== undefined;
}

function buildRebaseRelation(
  event: HistoryEvent,
  commits: Map<string, GitCommit>,
  options: RebaseRelationOptions,
): RebaseRelation | undefined {
  if (event.type !== 'rebase' || !event.fromOid || event.fromOid === event.toOid) return undefined;
  if (options.operations?.some((operation) => operation.type === 'rebase')) return undefined;
  if (!commits.has(event.fromOid) || !commits.has(event.toOid)) return undefined;
  const ontoOid = resolveKnownOid(parseRebaseOntoOid(event.rawReflogMessage ?? event.subject), commits);
  if (!ontoOid) return undefined;
  const ontoReachable = reachableFrom(ontoOid, commits);
  if (!ontoReachable) return undefined;
  const oldOids = exclusiveLinearRange(event.fromOid, ontoReachable, commits);
  const newOids = exclusiveLinearRange(event.toOid, ontoReachable, commits);
  if (!oldOids || !newOids) return undefined;
  if (oldOids.length !== newOids.length) return undefined;
  if (oldOids.at(-1) !== event.fromOid || newOids.at(-1) !== event.toOid) return undefined;
  if (oldOids.includes(ontoOid) || newOids.includes(ontoOid)) return undefined;
  const session = rebaseSessionForEvent(event, options.reflogs ?? []);
  if (!session || session.interactive) return undefined;
  if (session.pickCount > 0 && session.pickCount !== oldOids.length) return undefined;
  if (!oldOids.every((oid) => commits.has(oid)) || !newOids.every((oid) => commits.has(oid))) return undefined;
  return {
    id: event.id,
    kind: 'rebase',
    refName: event.refName,
    oldOids,
    newOids,
    oldTipOid: event.fromOid,
    newTipOid: event.toOid,
    ontoOid,
    timestamp: event.timestamp,
    rawReflogMessage: event.rawReflogMessage ?? event.subject,
    evidence: 'reflog',
  };
}

export function buildRebaseRelations(
  events: HistoryEvent[],
  commits: Map<string, GitCommit>,
  options: RebaseRelationOptions = {},
): RebaseRelation[] {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    const relation = buildRebaseRelation(event, commits, options);
    if (!relation) return [];
    const key = `${relation.refName}\0${relation.oldTipOid}\0${relation.newTipOid}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [relation];
  });
}
