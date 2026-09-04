import type { GitCommit, HistoryEvent, OperationState, ReflogEntry } from '../git/gitTypes.js';
import type { RewriteCollapseRelation } from './graphModel.js';
import {
  collectRebaseSessionEntries,
  exclusiveLinearRange,
  parseRebaseOntoOid,
  type RebaseRelationOptions,
} from './rebaseRelation.js';

const REBASE_PICK = /^rebase\s+\(pick\)/i;
const REBASE_START = /^rebase\s+\(start\)/i;
const REBASE_FINISH = /^rebase\s+\(finish\)/i;
const REBASE_SQUASH = /^rebase\s+\(squash\)/i;
const REBASE_FIXUP = /^rebase\s+\(fixup\)/i;
const REBASE_UNSUPPORTED = /^rebase\s+\((?:drop|reword|edit|merge)\)/i;

export type RewriteCollapseKind = 'squash' | 'fixup';
export type RewriteCollapseOptions = RebaseRelationOptions;

/** Selection identity distinct from generic rebase History Event / RebaseRelation ids. */
export function rewriteCollapseRelationId(kind: RewriteCollapseKind, refName: string, oldTipOid: string, newTipOid: string): string {
  return `rewrite-collapse:${kind}:${refName}:${oldTipOid}:${newTipOid}`;
}

type SessionAction = 'start' | 'finish' | 'pick' | 'squash' | 'fixup' | 'unsupported';

function sessionAction(subject: string): SessionAction {
  if (REBASE_START.test(subject)) return 'start';
  if (REBASE_FINISH.test(subject)) return 'finish';
  if (REBASE_PICK.test(subject)) return 'pick';
  if (REBASE_SQUASH.test(subject)) return 'squash';
  if (REBASE_FIXUP.test(subject)) return 'fixup';
  if (REBASE_UNSUPPORTED.test(subject)) return 'unsupported';
  return 'unsupported';
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
 * Contiguous collapse only: start, picks, exactly one squash XOR fixup, finish.
 * A later pick (124/125 autosquash of a non-member) is not a dedicated overlay.
 */
function contiguousCollapseKind(sessionNewestFirst: ReflogEntry[]): RewriteCollapseKind | undefined {
  if (sessionNewestFirst.length < 3) return undefined;
  const chronological = sessionNewestFirst.slice().reverse();
  if (sessionAction(chronological[0]!.subject) !== 'start') return undefined;
  if (sessionAction(chronological.at(-1)!.subject) !== 'finish') return undefined;
  const middle = chronological.slice(1, -1);
  if (middle.length === 0) return undefined;
  const actions = middle.map((entry) => sessionAction(entry.subject));
  if (actions.some((action) => action === 'unsupported' || action === 'start' || action === 'finish')) return undefined;
  const squashCount = actions.filter((action) => action === 'squash').length;
  const fixupCount = actions.filter((action) => action === 'fixup').length;
  if (squashCount + fixupCount !== 1) return undefined;
  const kind: RewriteCollapseKind = squashCount === 1 ? 'squash' : 'fixup';
  const collapseAt = actions.findIndex((action) => action === kind);
  if (collapseAt < 1) return undefined;
  if (actions.slice(0, collapseAt).some((action) => action !== 'pick')) return undefined;
  if (actions.slice(collapseAt + 1).length > 0) return undefined;
  return kind;
}

function buildRewriteCollapseRelation(
  event: HistoryEvent,
  commits: Map<string, GitCommit>,
  options: RewriteCollapseOptions,
): RewriteCollapseRelation | undefined {
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
  if (oldOids.length < 2 || newOids.length !== 1) return undefined;
  if (oldOids.at(-1) !== event.fromOid || newOids[0] !== event.toOid) return undefined;
  if (oldOids.includes(ontoOid) || newOids.includes(ontoOid)) return undefined;
  if (!oldOids.every((oid) => commits.has(oid)) || !commits.has(event.toOid)) return undefined;
  const session = collectRebaseSessionEntries(event, options.reflogs ?? []);
  if (!session) return undefined;
  const kind = contiguousCollapseKind(session);
  if (!kind) return undefined;
  return {
    id: rewriteCollapseRelationId(kind, event.refName, event.fromOid, event.toOid),
    kind,
    refName: event.refName,
    oldOids,
    newOid: event.toOid,
    oldTipOid: event.fromOid,
    newTipOid: event.toOid,
    ontoOid,
    timestamp: event.timestamp,
    rawReflogMessage: event.rawReflogMessage ?? event.subject,
    evidence: 'reflog',
  };
}

export function isCompleteRewriteCollapseOverlay(
  event: HistoryEvent,
  commits: Map<string, GitCommit>,
  options: RewriteCollapseOptions = {},
): boolean {
  return buildRewriteCollapseRelation(event, commits, options) !== undefined;
}

export function buildRewriteCollapseRelations(
  events: HistoryEvent[],
  commits: Map<string, GitCommit>,
  options: RewriteCollapseOptions = {},
): RewriteCollapseRelation[] {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    const relation = buildRewriteCollapseRelation(event, commits, options);
    if (!relation) return [];
    if (seen.has(relation.id)) return [];
    seen.add(relation.id);
    return [relation];
  });
}

/**
 * Hide only the pick commit that this same collapse session immediately
 * replaced.  Unreferenced-alone is never enough.
 */
export function transientOidsForRewriteCollapse(
  relations: RewriteCollapseRelation[],
  events: HistoryEvent[],
  reflogs: ReflogEntry[],
  commits: Map<string, GitCommit>,
  liveReachable: Set<string>,
): Set<string> {
  const hidden = new Set<string>();
  for (const relation of relations) {
    const event = events.find((candidate) => candidate.type === 'rebase' && candidate.refName === relation.refName && candidate.fromOid === relation.oldTipOid && candidate.toOid === relation.newTipOid);
    if (!event) continue;
    const session = collectRebaseSessionEntries(event, reflogs);
    if (!session) continue;
    const chronological = session.slice().reverse();
    for (let index = 0; index < chronological.length - 1; index += 1) {
      const entry = chronological[index]!;
      const next = chronological[index + 1]!;
      if (sessionAction(entry.subject) !== 'pick') continue;
      if (sessionAction(next.subject) !== relation.kind) continue;
      const generated = resolveKnownOid(entry.newOid, commits);
      const replacedFrom = resolveKnownOid(next.previousOid, commits);
      if (!generated || generated !== replacedFrom) continue;
      if (relation.oldOids.includes(generated) || generated === relation.newOid) continue;
      if (liveReachable.has(generated)) continue;
      if (!commits.has(generated)) continue;
      hidden.add(generated);
    }
  }
  return hidden;
}
