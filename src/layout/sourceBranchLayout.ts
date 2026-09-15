import type { GitCommit, ReflogEntry } from '../git/gitTypes.js';
import { branchCommitOrigins } from '../model/branchProtection.js';
import { lineageFamily, type BranchLineage } from '../model/branchLineage.js';
import type { BranchSegment } from './laneLayout.js';

interface LineageTrack { id: string; family: string; synthetic?: boolean }

export function sourceTrackParents(candidates: LineageTrack[], relations: BranchLineage[]): Map<string, string> {
  const idFor = (name: string): string | undefined => {
    const matches = candidates.filter((c) => c.family === name && !c.synthetic);
    return matches.length === 1 ? matches[0].id : undefined;
  };
  const parents = new Map<string, string>();
  for (const relation of relations) {
    const parent = idFor(relation.parent), child = idFor(relation.child);
    if (parent && child && parent !== child) parents.set(child, parent);
  }
  for (const child of [...parents.keys()]) {
    const seen = new Set([child]); let current = parents.get(child);
    while (current) {
      if (seen.has(current)) { for (const id of seen) parents.delete(id); break; }
      seen.add(current); current = parents.get(current);
    }
  }
  return parents;
}

/** Correct only evidence-backed claims within a known lineage or merged side route. */
export function restoreSourceBranchClaims(claims: Map<string, string>, candidates: LineageTrack[], commits: GitCommit[], logs: ReflogEntry[], parents: ReadonlyMap<string, string>): void {
  const origins = branchCommitOrigins(logs, commits);
  const sourceTracks = new Set(parents.values());
  for (const [oid, name] of origins) {
    const matches = candidates.filter((c) => c.family === lineageFamily(name) && !c.synthetic);
    if (matches.length !== 1) continue;
    const destination = matches[0].id, current = claims.get(oid);
    let ancestor = current ? parents.get(current) : undefined;
    while (ancestor) {
      if (ancestor === destination) { claims.set(oid, destination); break; }
      ancestor = parents.get(ancestor);
    }
    ancestor = parents.get(destination);
    while (ancestor) {
      if (ancestor === current) { claims.set(oid, destination); break; }
      ancestor = parents.get(ancestor);
    }
    const existing = candidates.find((c) => c.id === current);
    if (existing?.family.startsWith('merged-side:') && (parents.has(destination) || sourceTracks.has(destination))) claims.set(oid, destination);
  }
}

/** Stable order: move a segment only when its source still needs a lane. */
export function orderSegmentsBySource(segments: BranchSegment[], parents: ReadonlyMap<string, string> = new Map(), primaryTrackId?: string): BranchSegment[] {
  if (!parents.size) return segments;
  const result: BranchSegment[] = [], remaining = [...segments];
  while (remaining.length) {
    const index = remaining.findIndex((s) => parents.get(s.trackId) === primaryTrackId || !remaining.some((p) => p.trackId === parents.get(s.trackId)));
    if (index < 0) return segments;
    result.push(...remaining.splice(index, 1));
  }
  return result;
}

export function minimumSourceLane(segment: BranchSegment, segments: BranchSegment[], assigned: ReadonlyMap<string, number>, parents: ReadonlyMap<string, string> = new Map()): number {
  const lanes = segments.filter((s) => s.trackId === parents.get(segment.trackId)).map((s) => assigned.get(s.id)).filter((n): n is number => n !== undefined);
  return lanes.length ? Math.max(...lanes) + 1 : 1;
}
