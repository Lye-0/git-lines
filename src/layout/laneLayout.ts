import type { GitCommit, GitRef } from '../git/gitTypes.js';
import type { GraphFactModel, GraphNode, GraphTrack } from '../model/graphModel.js';

export interface LaneLayoutOptions {
  previousLanes?: Map<string, number>;
  primaryBranch?: string;
}

interface TrackCandidate {
  id: string;
  family: string;
  kind: 'local' | 'remote';
  refs: GitRef[];
  oids: Set<string>;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) h = Math.imul(h ^ value.charCodeAt(index), 16777619);
  return h >>> 0;
}

function familyFor(ref: GitRef): string {
  if (ref.type === 'local') return ref.shortName;
  const match = /^([^/]+)\/(.*)$/.exec(ref.shortName);
  return match?.[2] ?? ref.shortName;
}

function colorFor(family: string, used: Set<number>): string {
  let hue = hash(family) % 360;
  while ([...used].some((usedHue) => Math.abs(usedHue - hue) < 24 || Math.abs(usedHue - hue) > 336)) hue = (hue + 37) % 360;
  used.add(hue);
  return `hsl(${hue} 76% 66%)`;
}

function ancestorSet(tip: string, commits: Map<string, GitCommit>): Set<string> {
  const result = new Set<string>();
  const queue = [tip];
  while (queue.length) {
    const oid = queue.shift() as string;
    if (result.has(oid)) continue;
    result.add(oid);
    for (const parent of commits.get(oid)?.parentOids ?? []) queue.push(parent);
  }
  return result;
}

function branchRefs(refs: GitRef[]): GitRef[] {
  return refs.filter((ref) => (ref.type === 'local' || ref.type === 'remote') && Boolean(ref.oid));
}

function makeCandidates(refs: GitRef[]): { candidates: TrackCandidate[]; refTrack: Map<string, string> } {
  const grouped = new Map<string, GitRef[]>();
  for (const ref of refs) grouped.set(familyFor(ref), [...(grouped.get(familyFor(ref)) ?? []), ref]);
  const candidates: TrackCandidate[] = [];
  const refTrack = new Map<string, string>();
  for (const [family, familyRefs] of grouped) {
    const byOid = new Map<string, GitRef[]>();
    for (const ref of familyRefs) byOid.set(ref.oid as string, [...(byOid.get(ref.oid as string) ?? []), ref]);
    if (byOid.size === 1) {
      const refsInGroup = familyRefs.slice().sort((a, b) => a.shortName.localeCompare(b.shortName));
      const id = `family:${family}`;
      const candidate: TrackCandidate = { id, family, kind: refsInGroup.some((ref) => ref.type === 'local') ? 'local' : 'remote', refs: refsInGroup, oids: new Set([familyRefs[0].oid as string]) };
      candidates.push(candidate);
      for (const ref of refsInGroup) refTrack.set(ref.fullName, id);
    } else {
      for (const ref of familyRefs) {
        const id = `${ref.type}:${ref.fullName}`;
        candidates.push({ id, family, kind: ref.type as 'local' | 'remote', refs: [ref], oids: new Set([ref.oid as string]) });
        refTrack.set(ref.fullName, id);
      }
    }
  }
  return { candidates, refTrack };
}

export function computeLaneLayout(facts: GraphFactModel, options: LaneLayoutOptions = {}): { nodes: GraphNode[]; tracks: GraphTrack[]; lanes: Map<string, number> } {
  const refs = branchRefs(facts.refs);
  const { candidates, refTrack } = makeCandidates(refs);
  const primary = options.primaryBranch ?? facts.primaryBranch;
  const primaryCandidate = candidates.find((candidate) => candidate.refs.some((ref) => ref.shortName === primary));
  const previous = options.previousLanes ?? new Map<string, number>();
  const ordered = candidates.slice().sort((a, b) => {
    if (a.id === primaryCandidate?.id) return -1;
    if (b.id === primaryCandidate?.id) return 1;
    const oldA = previous.get(a.id);
    const oldB = previous.get(b.id);
    if (oldA !== undefined && oldB !== undefined) return oldA - oldB;
    if (oldA !== undefined) return -1;
    if (oldB !== undefined) return 1;
    if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const lanes = new Map<string, number>();
  for (const candidate of ordered) {
    if (candidate.id === primaryCandidate?.id) lanes.set(candidate.id, 0);
    else {
      const occupied = new Set(lanes.values());
      let lane = previous.get(candidate.id) ?? 1;
      while (occupied.has(lane)) lane += 1;
      lanes.set(candidate.id, lane);
    }
  }
  const usedHues = new Set<number>();
  const tracks: GraphTrack[] = ordered.map((candidate) => ({
    id: candidate.id,
    label: candidate.refs.map((ref) => refDisplay(ref)).join(' · '),
    family: candidate.family,
    kind: candidate.kind,
    lane: lanes.get(candidate.id) as number,
    color: colorFor(candidate.family, usedHues),
    refNames: candidate.refs.map((ref) => ref.fullName),
  }));
  const commits = new Map(facts.commits.map((commit) => [commit.oid, commit]));
  const claims = new Map<string, string[]>();
  for (const candidate of candidates) {
    const ref = candidate.refs.find((item) => item.type === 'local') ?? candidate.refs[0];
    if (!ref?.oid) continue;
    for (const oid of ancestorSet(ref.oid, commits)) claims.set(oid, [...(claims.get(oid) ?? []), candidate.id]);
  }
  const priority = (trackId: string): number => {
    const candidate = candidates.find((item) => item.id === trackId);
    if (!candidate) return 999;
    if (trackId === primaryCandidate?.id) return -10;
    return candidate.kind === 'local' ? 0 : 1;
  };
  const laidOut = facts.nodes.map((node) => {
    let trackId: string | undefined;
    if (node.oid && claims.has(node.oid)) trackId = claims.get(node.oid)!.slice().sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))[0];
    if (!trackId && node.kind === 'working-tree') {
      const branch = node.refIds[0];
      const ref = refs.find((item) => item.shortName === branch);
      trackId = ref ? refTrack.get(ref.fullName) : undefined;
    }
    if (!trackId && node.kind === 'operation' && node.event?.refName) trackId = refTrack.get(node.event.refName);
    const lane = trackId ? lanes.get(trackId) : 0;
    return { ...node, trackId, lane: lane ?? 0 };
  });
  return { nodes: laidOut, tracks, lanes };
}

function refDisplay(ref: GitRef): string {
  return ref.shortName;
}
