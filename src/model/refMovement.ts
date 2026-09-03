import type { GitCommit, GitRef, HistoryEvent } from '../git/gitTypes.js';
import type { RefMovementRelation } from './graphModel.js';
import type { GraphRefBadge } from './refDisplay.js';
import { isUserFacingRef, specialRefBadge, uniqueGraphRefBadges } from './refDisplay.js';

export function isRefMovementEvent(event: HistoryEvent): event is HistoryEvent & { type: 'reset' | 'branch-move'; fromOid?: string } {
  return event.type === 'reset' || event.type === 'branch-move';
}

export function isCompleteRefMovement(event: HistoryEvent, commits: Map<string, GitCommit>): boolean {
  return isRefMovementEvent(event)
    && Boolean(event.fromOid)
    && event.fromOid !== event.toOid
    && commits.has(event.fromOid as string)
    && commits.has(event.toOid);
}

export function buildRefMovementRelations(events: HistoryEvent[], commits: Map<string, GitCommit>): RefMovementRelation[] {
  const seen = new Set<string>();
  return events.flatMap((event) => {
    if (!isCompleteRefMovement(event, commits) || !event.fromOid) return [];
    const key = `${event.type}\0${event.refName}\0${event.fromOid}\0${event.toOid}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      id: event.id,
      kind: event.type as RefMovementRelation['kind'],
      refName: event.refName,
      fromOid: event.fromOid,
      toOid: event.toOid,
      timestamp: event.timestamp,
      rawReflogMessage: event.rawReflogMessage ?? event.subject,
      evidence: 'reflog' as const,
      ...(event.resetMode ? { resetMode: event.resetMode } : {}),
      ...(event.removedCommitCount ? { removedCommitCount: event.removedCommitCount } : {}),
      ...(event.removedRangeStartOid ? { removedRangeStartOid: event.removedRangeStartOid } : {}),
      ...(event.removedRangeEndOid ? { removedRangeEndOid: event.removedRangeEndOid } : {}),
    }];
  });
}

/**
 * Ghost badges mark historical ref positions only.  The current live ref
 * keeps its existing solid badge; intermediates between from/to are omitted.
 */
export function ghostRefBadgesByOid(
  relations: RefMovementRelation[],
  refs: GitRef[],
  currentBranch?: string,
): Map<string, GraphRefBadge[]> {
  const currentOidByRef = new Map(refs.filter((ref) => isUserFacingRef(ref) && ref.oid).map((ref) => [ref.fullName, ref.oid as string]));
  const collected = new Map<string, GraphRefBadge[]>();
  const add = (oid: string, refName: string) => {
    if (currentOidByRef.get(refName) === oid) return;
    const badge = specialRefBadge(refName);
    const existing = collected.get(oid) ?? [];
    if (existing.some((candidate) => candidate.fullName === badge.fullName)) return;
    collected.set(oid, [...existing, badge]);
  };
  for (const relation of relations) {
    add(relation.fromOid, relation.refName);
    add(relation.toOid, relation.refName);
  }
  return new Map([...collected.entries()].map(([oid, badges]) => [oid, uniqueGraphRefBadges(badges, currentBranch)]));
}
