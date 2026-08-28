import type { GitCommit, GitRef } from '../git/gitTypes.js';
import type { GraphFactModel, GraphNode, GraphTrack } from '../model/graphModel.js';
import { normalizeRefName } from '../model/refDisplay.js';

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
  const shortName = normalizeRefName(ref.shortName || ref.fullName);
  if (ref.type === 'local') return shortName;
  const match = /^([^/]+)\/(.*)$/.exec(shortName);
  return match?.[2] ?? shortName;
}

function colorFor(family: string, used: Set<number>): string {
  let hue = hash(family) % 360;
  let attempts = 0;
  while (attempts < 24 && [...used].some((usedHue) => Math.abs(usedHue - hue) < 24 || Math.abs(usedHue - hue) > 336)) {
    hue = (hue + 37) % 360;
    attempts += 1;
  }
  used.add(hue);
  return `hsl(${hue} 76% 66%)`;
}

/**
 * Returns the shortest parent distance from a ref tip to each reachable
 * commit.  A merged feature commit is one edge farther away from the main
 * tip than from the feature tip, so this keeps it on the feature lane while
 * still assigning shared ancestors to the primary lane.
 */
function ancestorDistances(tip: string, commits: Map<string, GitCommit>): Map<string, number> {
  const result = new Map<string, number>();
  const queue: Array<{ oid: string; distance: number }> = [{ oid: tip, distance: 0 }];
  while (queue.length) {
    const current = queue.shift() as { oid: string; distance: number };
    const known = result.get(current.oid);
    if (known !== undefined && known <= current.distance) continue;
    result.set(current.oid, current.distance);
    for (const parent of commits.get(current.oid)?.parentOids ?? []) {
      queue.push({ oid: parent, distance: current.distance + 1 });
    }
  }
  return result;
}

function branchRefs(refs: GitRef[]): GitRef[] {
  return refs.filter((ref) => (ref.type === 'local' || ref.type === 'remote') && !ref.fullName.endsWith('/HEAD') && Boolean(ref.oid));
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
      const refsInGroup = familyRefs.slice().sort((a, b) => refDisplay(a).localeCompare(refDisplay(b)) || a.fullName.localeCompare(b.fullName));
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
  const eventTrackForRef = (refName?: string): string | undefined => {
    if (!refName) return undefined;
    const direct = refTrack.get(refName);
    if (direct) return direct;
    const normalized = normalizeRefName(refName);
    const matching = facts.refs.find((ref) => ref.fullName === refName || ref.shortName === refName || normalizeRefName(ref.fullName) === normalized);
    if (matching) {
      const matchingTrack = refTrack.get(matching.fullName);
      if (matchingTrack) return matchingTrack;
      if (matching.targetRef) {
        const targetTrack = refTrack.get(matching.targetRef);
        if (targetTrack) return targetTrack;
      }
    }
    if (refName === 'HEAD') {
      const checkedOutBranch = facts.workingTrees.find((tree) => !tree.inaccessible && tree.branch)?.branch;
      const branchRef = facts.refs.find((ref) => ref.type === 'local' && (ref.shortName === checkedOutBranch || normalizeRefName(ref.fullName) === checkedOutBranch));
      if (branchRef) return refTrack.get(branchRef.fullName);
    }
    return [...refTrack.entries()].find(([name]) => normalizeRefName(name) === normalized)?.[1];
  };
  const primary = options.primaryBranch ?? facts.primaryBranch;
  const primaryCandidate = candidates.find((candidate) => candidate.refs.some((ref) => normalizeRefName(ref.shortName || ref.fullName) === primary));
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
  const familyColors = new Map<string, string>();
  const tracks: GraphTrack[] = ordered.map((candidate) => ({
    id: candidate.id,
    label: candidate.refs.map((ref) => refDisplay(ref)).join(' · '),
    family: candidate.family,
    kind: candidate.kind,
    lane: lanes.get(candidate.id) as number,
    color: familyColors.get(candidate.family) ?? (() => {
      const color = colorFor(candidate.family, usedHues);
      familyColors.set(candidate.family, color);
      return color;
    })(),
    refNames: candidate.refs.map((ref) => ref.fullName),
  }));
  const commits = new Map(facts.commits.map((commit) => [commit.oid, commit]));
  const claims = new Map<string, Array<{ trackId: string; distance: number }>>();
  for (const candidate of candidates) {
    const ref = candidate.refs.find((item) => item.type === 'local') ?? candidate.refs[0];
    if (!ref?.oid) continue;
    for (const [oid, distance] of ancestorDistances(ref.oid, commits)) {
      claims.set(oid, [...(claims.get(oid) ?? []), { trackId: candidate.id, distance }]);
    }
  }
  const priority = (trackId: string): number => {
    const candidate = candidates.find((item) => item.id === trackId);
    if (!candidate) return 999;
    if (trackId === primaryCandidate?.id) return -10;
    return candidate.kind === 'local' ? 0 : 1;
  };
  const trackForClaim = (oid: string): string | undefined => claims.get(oid)
    ?.slice()
    .sort((a, b) => a.distance - b.distance || priority(a.trackId) - priority(b.trackId) || a.trackId.localeCompare(b.trackId))[0]
    ?.trackId;
  const initialAssignments = facts.nodes.map((node) => {
    let trackId: string | undefined;
    // A clean working tree on a newly-created branch has the same OID as the
    // parent commit.  It must follow the checked-out branch track before the
    // commit claim is considered, otherwise it is incorrectly drawn on main.
    if (node.kind === 'working-tree') {
      const branch = node.workingTree?.branch ?? node.refIds[0];
      const ref = refs.find((item) => item.shortName === branch || normalizeRefName(item.fullName) === branch);
      trackId = ref ? refTrack.get(ref.fullName) : undefined;
    }
    // Ref events must share the target ref's lane even when their destination
    // commit is claimed by another branch (for example a feature reset to a
    // main commit).  Resolve this before commit ancestry claims.
    if (!trackId && node.event?.refName) trackId = eventTrackForRef(node.targetRef ?? node.event.refName);
    if (!trackId && node.oid) trackId = trackForClaim(node.oid);
    const lane = trackId ? lanes.get(trackId) : 0;
    return { node, trackId, lane: lane ?? 0 };
  });
  const laidOut = initialAssignments.map(({ node, trackId, lane }) => {
    if (!node.event) return { ...node, trackId, lane };
    const eventTrackId = eventTrackForRef(node.targetRef ?? node.event.refName) ?? trackId;
    const eventLane = eventTrackId ? lanes.get(eventTrackId) ?? lane : lane;
    // The event track is presentation metadata only.  It never contributes
    // a commit claim or a new GraphTrack/lane.
    return { ...node, trackId: eventTrackId, targetLaneId: eventTrackId ?? node.targetLaneId, lane: eventLane };
  });
  return { nodes: laidOut, tracks, lanes };
}

function refDisplay(ref: GitRef): string {
  return normalizeRefName(ref.shortName || ref.fullName);
}
