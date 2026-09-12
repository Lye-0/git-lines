import type { GitCommit, HistoryEvent, OperationState, ReflogEntry } from '../git/gitTypes.js';
import type { HistoryRelation } from './graphModel.js';
import { collectRebaseSessionEntries } from './rebaseRelation.js';

const REWORD = /^rebase\s+\(reword\):/i;

/** Local replayed-T → rewritten-T only; never a pre-rebase member mapping. */
export function buildRewordRelations(
  events: HistoryEvent[],
  commits: Map<string, GitCommit>,
  reflogs: ReflogEntry[],
  operations: OperationState[] = [],
): HistoryRelation[] {
  if (operations.some((operation) => operation.type === 'rebase')) return [];
  const head = reflogs.filter((entry) => entry.refName === 'HEAD');
  // Duplicate selectors or competing finish records cannot identify one session.
  if (new Set(head.map((entry) => entry.selector)).size !== head.length) return [];
  const relations: HistoryRelation[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'rebase' || !event.fromOid || !event.boundaryOid) continue;
    const finishes = head.filter((entry) => /^rebase\s+\(finish\):\s+returning\s+to\s+/i.test(entry.subject) && entry.newOid === event.toOid);
    if (finishes.length !== 1 || finishes[0].subject.trim() !== `rebase (finish): returning to ${event.refName}`) continue;
    const session = collectRebaseSessionEntries(event, reflogs)?.slice().reverse();
    if (!session || session[0].previousOid !== event.fromOid) continue;
    if (session.some((entry, index) => !commits.has(entry.newOid)
      || !entry.previousOid || !commits.has(entry.previousOid)
      || (index > 0 && entry.previousOid !== session[index - 1].newOid))) continue;
    for (let index = 0; index < session.length; index += 1) {
      if (!REWORD.test(session[index].subject)) continue;
      const start = index;
      while (index + 1 < session.length && REWORD.test(session[index + 1].subject)) index += 1;
      // v1 recognizes the observed two-step replay/reword grammar only.
      if (index - start !== 1) continue;
      const first = session[start];
      const second = session[index];
      const sourceOid = second.previousOid!;
      const targetOid = second.newOid;
      if (sourceOid !== first.newOid || sourceOid === targetOid) continue;
      const source = commits.get(sourceOid)!;
      const target = commits.get(targetOid)!;
      // Defensive topology check, not identity inference: a replay adds a
      // child; a local reword replaces that child while retaining its parent.
      if (source.parentOids.length !== 1 || target.parentOids.length !== 1
        || source.parentOids[0] !== first.previousOid
        || target.parentOids[0] !== source.parentOids[0]) continue;
      const id = `history:reword:${sourceOid}:${targetOid}`;
      if (seen.has(id)) continue;
      seen.add(id);
      relations.push({ id, kind: 'reword', sourceOid, targetOid, refName: event.refName,
        timestamp: second.timestamp, rawReflogMessage: second.subject, evidence: 'reflog' });
    }
  }
  return relations;
}
