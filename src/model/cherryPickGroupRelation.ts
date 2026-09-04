import type { GitCommit, HistoryEvent, OperationState, ReflogEntry } from '../git/gitTypes.js';
import type { CherryPickGroupRelation, HistoryRelation } from './graphModel.js';
import { exclusiveLinearRange } from './rebaseRelation.js';

const FULL_OID = /^[0-9a-f]{40,64}$/i;
const CHERRY_PICK_SUBJECT = /^(?:cherry-pick(?:\s|\(|:|$)|commit\s+\(cherry-pick\):)/i;

export interface CherryPickExactMapping {
  sourceOid: string;
  targetOid: string;
}

export interface CherryPickGroupOptions {
  events?: HistoryEvent[];
  reflogs?: ReflogEntry[];
  operations?: OperationState[];
}

function isExactCherryPick(relation: HistoryRelation): boolean {
  return relation.kind === 'cherry-pick'
    && FULL_OID.test(relation.sourceOid)
    && FULL_OID.test(relation.targetOid)
    && relation.sourceOid !== relation.targetOid;
}

function reachableSingleton(oid: string): Set<string> {
  return new Set([oid]);
}

function firstParentChildren(parentOid: string, commits: Map<string, GitCommit>): string[] {
  return [...commits.values()]
    .filter((commit) => commit.parentOids[0] === parentOid)
    .map((commit) => commit.oid);
}

function linearRangeThrough(tipOid: string, oldestOid: string, commits: Map<string, GitCommit>): string[] | undefined {
  const oldest = commits.get(oldestOid);
  if (!oldest) return undefined;
  const stop = oldest.parentOids[0] ? reachableSingleton(oldest.parentOids[0]) : new Set<string>();
  if (stop.size === 0) {
    const newestFirst: string[] = [];
    let current: string | undefined = tipOid;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const commit = commits.get(current);
      if (!commit || commit.parentOids.length > 1) return undefined;
      newestFirst.push(current);
      if (current === oldestOid) {
        if (commit.parentOids.length !== 0 && commit.parentOids.length !== 1) return undefined;
        return newestFirst.slice().reverse();
      }
      if (commit.parentOids.length !== 1) return undefined;
      current = commit.parentOids[0];
    }
    return undefined;
  }
  const range = exclusiveLinearRange(tipOid, stop, commits);
  if (!range || range[0] !== oldestOid) return undefined;
  return range;
}

function cherryPickEventTargets(events: HistoryEvent[]): Set<string> {
  const targets = new Set<string>();
  for (const event of events) {
    if (event.type === 'cherry-pick') targets.add(event.toOid);
  }
  return targets;
}

function expandWithAdjacentCherryPicks(
  chain: string[],
  cherryPickTargets: Set<string>,
  commits: Map<string, GitCommit>,
): string[] | undefined {
  let oldest = chain[0]!;
  let newest = chain.at(-1)!;
  const visited = new Set(chain);

  while (true) {
    const parent = commits.get(oldest)?.parentOids[0];
    if (!parent || !cherryPickTargets.has(parent) || visited.has(parent)) break;
    const parentCommit = commits.get(parent);
    if (!parentCommit || parentCommit.parentOids.length > 1) return undefined;
    visited.add(parent);
    oldest = parent;
  }

  while (true) {
    const children = firstParentChildren(newest, commits).filter((oid) => cherryPickTargets.has(oid) && !visited.has(oid));
    if (children.length === 0) break;
    if (children.length !== 1) return undefined;
    const child = children[0]!;
    const childCommit = commits.get(child);
    if (!childCommit || childCommit.parentOids.length !== 1) return undefined;
    visited.add(child);
    newest = child;
  }

  return linearRangeThrough(newest, oldest, commits);
}

function interveningUnsafe(
  targetOids: string[],
  commits: Map<string, GitCommit>,
  events: HistoryEvent[],
): boolean {
  const newest = targetOids.at(-1)!;
  const oldest = targetOids[0]!;
  const range = linearRangeThrough(newest, oldest, commits);
  if (!range) return true;
  if (range.length !== targetOids.length) return true;
  if (range.some((oid, index) => oid !== targetOids[index])) return true;
  const members = new Set(targetOids);
  for (const event of events) {
    if (event.type === 'cherry-pick') continue;
    if (event.type === 'amend' || event.type === 'rebase' || event.type === 'reset' || event.type === 'revert') {
      if (members.has(event.toOid) || (event.fromOid && members.has(event.fromOid))) return true;
      if (range.includes(event.toOid)) return true;
    }
  }
  return false;
}

function reflogIndex(entry: ReflogEntry): number | undefined {
  const match = /@\{(\d+)\}$/.exec(entry.selector.trim());
  return match ? Number(match[1]) : undefined;
}

function isCherryPickSubject(subject: string): boolean {
  return CHERRY_PICK_SUBJECT.test(subject.trim());
}

/**
 * HEAD entries for the newest→oldest target chain must be consecutive
 * cherry-pick subjects.  Missing reflog evidence is not treated as proof of
 * a split session; topology already constrained the chain.
 */
function contiguousCherryPickReflog(targetOids: string[], reflogs: ReflogEntry[]): boolean {
  const newestFirst = targetOids.slice().reverse();
  const byIndex = new Map<number, ReflogEntry>();
  for (const entry of reflogs) {
    if (entry.refName !== 'HEAD') continue;
    const index = reflogIndex(entry);
    if (index === undefined) continue;
    byIndex.set(index, entry);
  }
  if (byIndex.size === 0) return true;
  const start = [...byIndex.values()].find((entry) => entry.newOid === newestFirst[0] && isCherryPickSubject(entry.subject));
  if (!start) return true;
  let index = reflogIndex(start);
  if (index === undefined) return false;
  for (const expected of newestFirst) {
    const entry = byIndex.get(index);
    if (!entry || entry.newOid !== expected || !isCherryPickSubject(entry.subject)) return false;
    index += 1;
  }
  return true;
}

function sourceOrderMatches(sourceOids: string[], commits: Map<string, GitCommit>): boolean {
  const oldest = sourceOids[0]!;
  const newest = sourceOids.at(-1)!;
  const range = linearRangeThrough(newest, oldest, commits);
  return Boolean(range && range.length === sourceOids.length && range.every((oid, index) => oid === sourceOids[index]));
}

function tryGroup(
  ordered: HistoryRelation[],
  commits: Map<string, GitCommit>,
  events: HistoryEvent[],
  reflogs: ReflogEntry[],
): CherryPickGroupRelation | undefined {
  if (ordered.length < 2) return undefined;
  if (!ordered.every(isExactCherryPick)) return undefined;
  const targetOids = ordered.map((relation) => relation.targetOid);
  const sourceOids = ordered.map((relation) => relation.sourceOid);
  if (new Set(sourceOids).size !== sourceOids.length) return undefined;
  if (new Set(targetOids).size !== targetOids.length) return undefined;
  if (!sourceOids.every((oid) => commits.has(oid)) || !targetOids.every((oid) => commits.has(oid))) return undefined;

  const expanded = expandWithAdjacentCherryPicks(targetOids, cherryPickEventTargets(events), commits);
  if (!expanded || expanded.length !== targetOids.length) return undefined;
  if (interveningUnsafe(targetOids, commits, events)) return undefined;
  if (!sourceOrderMatches(sourceOids, commits)) return undefined;
  if (!contiguousCherryPickReflog(targetOids, reflogs)) return undefined;

  const timestamp = Math.max(...ordered.map((relation) => relation.timestamp));
  const targetRefName = ordered.map((relation) => relation.refName).find((name) => name && name !== 'HEAD');
  return {
    id: `history:cherry-pick-group:${timestamp}:${targetOids.at(-1)}`,
    kind: 'cherry-pick-group',
    mappings: ordered.map((relation) => ({ sourceOid: relation.sourceOid, targetOid: relation.targetOid })),
    sourceOids,
    targetOids,
    sourceTipOid: sourceOids.at(-1)!,
    targetTipOid: targetOids.at(-1)!,
    ...(targetRefName ? { targetRefName, refName: targetRefName } : {}),
    timestamp,
    rawReflogMessage: ordered.at(-1)?.rawReflogMessage,
    evidence: 'commit-body',
  };
}

function sortExactChains(relations: HistoryRelation[], commits: Map<string, GitCommit>): HistoryRelation[][] {
  const remaining = new Set(relations.filter(isExactCherryPick));
  const chains: HistoryRelation[][] = [];
  const byTarget = new Map(relations.filter(isExactCherryPick).map((relation) => [relation.targetOid, relation]));

  while (remaining.size > 0) {
    const start = [...remaining][0]!;
    let oldest = start;
    while (true) {
      const parent = commits.get(oldest.targetOid)?.parentOids[0];
      const parentRelation = parent ? byTarget.get(parent) : undefined;
      if (!parentRelation || !remaining.has(parentRelation)) break;
      oldest = parentRelation;
    }
    const chain: HistoryRelation[] = [];
    let current: HistoryRelation | undefined = oldest;
    while (current && remaining.has(current)) {
      chain.push(current);
      remaining.delete(current);
      const children: HistoryRelation[] = [];
      for (const oid of firstParentChildren(current.targetOid, commits)) {
        const next = byTarget.get(oid);
        if (next && remaining.has(next)) children.push(next);
      }
      if (children.length > 1) {
        for (const extra of children) remaining.delete(extra);
        current = undefined;
        break;
      }
      current = children[0];
    }
    if (chain.length > 0) chains.push(chain);
  }
  return chains;
}

/**
 * Groups contiguous exact cherry-pick HistoryRelations that share one
 * `-x`-proven session.  Partial evidence, non-linear targets, unmatched
 * source order, or intervening rewrite operations leave the individuals
 * ungrouped.
 */
export function buildCherryPickGroups(
  relations: HistoryRelation[],
  commits: Map<string, GitCommit>,
  options: CherryPickGroupOptions = {},
): { groups: CherryPickGroupRelation[]; remaining: HistoryRelation[] } {
  if (options.operations?.some((operation) => operation.type === 'cherry-pick')) {
    return { groups: [], remaining: relations };
  }
  const events = options.events ?? [];
  const reflogs = options.reflogs ?? [];
  const groupedTargets = new Set<string>();
  const groups: CherryPickGroupRelation[] = [];
  for (const chain of sortExactChains(relations, commits)) {
    const group = tryGroup(chain, commits, events, reflogs);
    if (!group) continue;
    groups.push(group);
    for (const mapping of group.mappings) groupedTargets.add(mapping.targetOid);
  }
  return {
    groups,
    remaining: relations.filter((relation) => relation.kind !== 'cherry-pick' || !groupedTargets.has(relation.targetOid)),
  };
}
