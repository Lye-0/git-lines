import type { GitCommit, GitRef } from '../git/gitTypes.js';
import type { GraphFactModel, GraphNode, GraphTrack } from '../model/graphModel.js';
import { normalizeRefName } from '../model/refDisplay.js';

export interface LaneLayoutOptions {
  previousLanes?: Map<string, number>;
  previousNodeLanes?: Map<string, number>;
  primaryBranch?: string;
}

export interface BranchSegment {
  id: string;
  trackId: string;
  startRow: number;
  endRow: number;
  nodeIds?: string[];
}

export interface SegmentLaneOptions {
  primaryTrackId?: string;
  previousLanes?: Map<string, number>;
  previousNodeLanes?: Map<string, number>;
}

interface TrackCandidate {
  id: string;
  family: string;
  kind: 'local' | 'remote';
  refs: GitRef[];
  oids: Set<string>;
}

function interval(segment: Pick<BranchSegment, 'startRow' | 'endRow'>): { startRow: number; endRow: number } {
  return segment.startRow <= segment.endRow
    ? { startRow: segment.startRow, endRow: segment.endRow }
    : { startRow: segment.endRow, endRow: segment.startRow };
}

function overlaps(a: Pick<BranchSegment, 'startRow' | 'endRow'>, b: Pick<BranchSegment, 'startRow' | 'endRow'>): boolean {
  const left = interval(a);
  const right = interval(b);
  return left.startRow <= right.endRow && right.startRow <= left.endRow;
}

/**
 * Assigns the smallest available non-primary lane to each visible branch
 * segment.  A lane is occupied only for that segment's Y interval, so a
 * later, non-overlapping segment can reuse it.  The returned map is keyed by
 * the stable segment id and never mutates the input segments.
 */
export function assignBranchSegmentLanes(segments: BranchSegment[], options: SegmentLaneOptions = {}): Map<string, number> {
  const previous = options.previousLanes ?? new Map<string, number>();
  const previousNodeLanes = options.previousNodeLanes;
  const laneSegments = new Map<number, BranchSegment[]>();
  const result = new Map<string, number>();
  const ordered = segments.slice().sort((a, b) => {
    const first = interval(a);
    const second = interval(b);
    const previousFirst = a.nodeIds?.some((nodeId) => previousNodeLanes?.has(nodeId)) || (!previousNodeLanes && previous.has(a.trackId)) ? 0 : 1;
    const previousSecond = b.nodeIds?.some((nodeId) => previousNodeLanes?.has(nodeId)) || (!previousNodeLanes && previous.has(b.trackId)) ? 0 : 1;
    return previousFirst - previousSecond
      || first.startRow - second.startRow
      || first.endRow - second.endRow
      || a.trackId.localeCompare(b.trackId)
      || a.id.localeCompare(b.id);
  });
  const isAvailable = (lane: number, segment: BranchSegment): boolean => !(laneSegments.get(lane) ?? []).some((other) => overlaps(other, segment));
  for (const segment of ordered) {
    if (segment.trackId === options.primaryTrackId) {
      result.set(segment.id, 0);
      continue;
    }
    const previousNodeLane = segment.nodeIds?.map((nodeId) => previousNodeLanes?.get(nodeId)).find((lane): lane is number => lane !== undefined && lane >= 1);
    const previousLane = previousNodeLane ?? (!previousNodeLanes ? previous.get(segment.trackId) : undefined);
    let lane = previousLane !== undefined && previousLane >= 1 && isAvailable(previousLane, segment) ? previousLane : 1;
    while (!isAvailable(lane, segment)) lane += 1;
    result.set(segment.id, lane);
    laneSegments.set(lane, [...(laneSegments.get(lane) ?? []), segment]);
  }
  return result;
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

function isAncestorOid(ancestorOid: string, descendantOid: string, commits: Map<string, GitCommit>): boolean {
  if (ancestorOid === descendantOid) return true;
  return ancestorDistances(descendantOid, commits).has(ancestorOid);
}

function refsShareLineage(first: GitRef, second: GitRef, commits: Map<string, GitCommit>): boolean {
  if (!first.oid || !second.oid) return false;
  return isAncestorOid(first.oid, second.oid, commits) || isAncestorOid(second.oid, first.oid, commits);
}

function branchRefs(refs: GitRef[]): GitRef[] {
  return refs.filter((ref) => (ref.type === 'local' || ref.type === 'remote') && !ref.fullName.endsWith('/HEAD') && Boolean(ref.oid));
}

function makeCandidates(refs: GitRef[], commits: Map<string, GitCommit>): { candidates: TrackCandidate[]; refTrack: Map<string, string> } {
  const grouped = new Map<string, GitRef[]>();
  for (const ref of refs) grouped.set(familyFor(ref), [...(grouped.get(familyFor(ref)) ?? []), ref]);
  const candidates: TrackCandidate[] = [];
  const refTrack = new Map<string, string>();
  for (const [family, familyRefs] of grouped) {
    // A local ref and its remote-tracking counterpart are one visual track
    // when their tips are comparable in the commit DAG.  Grouping by ref tip
    // alone would make a mid-chain remote badge create a second lane.  Keep
    // genuinely diverged tips separate, even when they share a ref family.
    const lineageGroups: GitRef[][] = [];
    for (const ref of familyRefs) {
      const compatibleGroup = lineageGroups.find((group) => group.every((member) => refsShareLineage(member, ref, commits)));
      if (compatibleGroup) compatibleGroup.push(ref);
      else lineageGroups.push([ref]);
    }
    for (const [groupIndex, group] of lineageGroups.entries()) {
      const refsInGroup = group.slice().sort((a, b) => refDisplay(a).localeCompare(refDisplay(b)) || a.fullName.localeCompare(b.fullName));
      const id = lineageGroups.length === 1
        ? `family:${family}`
        : refsInGroup.length > 1
          ? `family:${family}:${groupIndex}`
          : `${refsInGroup[0].type}:${refsInGroup[0].fullName}`;
      const candidate: TrackCandidate = {
        id,
        family,
        kind: refsInGroup.some((ref) => ref.type === 'local') ? 'local' : 'remote',
        refs: refsInGroup,
        oids: new Set(refsInGroup.map((ref) => ref.oid as string)),
      };
      candidates.push(candidate);
      for (const ref of refsInGroup) refTrack.set(ref.fullName, id);
    }
  }
  return { candidates, refTrack };
}

interface NodeAssignment {
  node: GraphNode;
  trackId?: string;
  row: number;
}

interface SegmentInterval {
  startRow: number;
  endRow: number;
  nodeIds: Set<string>;
}

function addInterval(intervalsByTrack: Map<string, SegmentInterval[]>, trackId: string | undefined, firstRow: number, secondRow: number, nodeIds: string[]): void {
  if (!trackId) return;
  const startRow = Math.min(firstRow, secondRow);
  const endRow = Math.max(firstRow, secondRow);
  const intervals = intervalsByTrack.get(trackId) ?? [];
  intervals.push({ startRow, endRow, nodeIds: new Set(nodeIds) });
  intervalsByTrack.set(trackId, intervals);
}

function buildBranchSegments(assignments: NodeAssignment[], edges: GraphFactModel['edges']): BranchSegment[] {
  const assignmentByNodeId = new Map(assignments.map((assignment) => [assignment.node.id, assignment]));
  const intervalsByTrack = new Map<string, SegmentInterval[]>();
  for (const assignment of assignments) {
    addInterval(intervalsByTrack, assignment.trackId, assignment.row, assignment.row, [assignment.node.id]);
  }
  for (const edge of edges) {
    const source = assignmentByNodeId.get(edge.fromNodeId);
    const target = assignmentByNodeId.get(edge.toNodeId);
    if (!source || !target) continue;
    if (edge.annotation === 'ref-event') {
      // Ref events are presentation annotations.  Their vertical connector
      // occupies the target ref's lane, not the anchor commit's lane.
      const eventTrack = target.trackId ?? source.trackId;
      addInterval(intervalsByTrack, eventTrack, source.row, target.row, [target.node.id, source.trackId === eventTrack ? source.node.id : '']);
      continue;
    }
    // A parent/working/operation edge keeps every lane it touches occupied
    // across the full Y interval.  This prevents a reused lane from crossing
    // a branch transition at a merge point.
    for (const trackId of new Set([source.trackId, target.trackId])) {
      if (!trackId) continue;
      addInterval(intervalsByTrack, trackId, source.row, target.row, [
        source.trackId === trackId ? source.node.id : '',
        target.trackId === trackId ? target.node.id : '',
      ]);
    }
  }
  const segments: BranchSegment[] = [];
  for (const [trackId, intervals] of intervalsByTrack) {
    const ordered = intervals.slice().sort((a, b) => a.startRow - b.startRow || a.endRow - b.endRow);
    let current: SegmentInterval | undefined;
    let segmentIndex = 0;
    for (const next of ordered) {
      if (!current || next.startRow > current.endRow) {
        if (current) {
          segments.push({ id: `segment:${trackId}:${segmentIndex++}`, trackId, startRow: current.startRow, endRow: current.endRow, nodeIds: [...current.nodeIds].filter(Boolean) });
        }
        current = { startRow: next.startRow, endRow: next.endRow, nodeIds: new Set(next.nodeIds) };
        continue;
      }
      current.endRow = Math.max(current.endRow, next.endRow);
      for (const nodeId of next.nodeIds) if (nodeId) current.nodeIds.add(nodeId);
    }
    if (current) segments.push({ id: `segment:${trackId}:${segmentIndex}`, trackId, startRow: current.startRow, endRow: current.endRow, nodeIds: [...current.nodeIds].filter(Boolean) });
  }
  return segments;
}

export function computeLaneLayout(facts: GraphFactModel, options: LaneLayoutOptions = {}): { nodes: GraphNode[]; tracks: GraphTrack[]; lanes: Map<string, number> } {
  const refs = branchRefs(facts.refs);
  const commits = new Map(facts.commits.map((commit) => [commit.oid, commit]));
  const { candidates, refTrack } = makeCandidates(refs, commits);
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
  const defaultPrimaryFamily = primary ?? candidates.find((candidate) => candidate.family === 'main' || candidate.family === 'master')?.family;
  const primaryCandidate = candidates.find((candidate) => candidate.family === defaultPrimaryFamily
    || candidate.refs.some((ref) => normalizeRefName(ref.shortName || ref.fullName) === primary));
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
  const claims = new Map<string, Array<{ trackId: string; distance: number }>>();
  for (const candidate of candidates) {
    // A unified local/remote track may have one tip ahead of the other.  Use
    // the union of all grouped ref ancestries so commits reachable only from
    // the remote-ahead ref are still assigned to the same track.
    const candidateDistances = new Map<string, number>();
    for (const ref of candidate.refs) {
      if (!ref.oid) continue;
      for (const [oid, distance] of ancestorDistances(ref.oid, commits)) {
        const knownDistance = candidateDistances.get(oid);
        if (knownDistance === undefined || distance < knownDistance) candidateDistances.set(oid, distance);
      }
    }
    for (const [oid, distance] of candidateDistances) {
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
  const initialAssignments = facts.nodes.map((node, index) => {
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
    return { node, trackId, row: node.row ?? index };
  });
  const segments = buildBranchSegments(initialAssignments, facts.edges);
  const segmentLanes = assignBranchSegmentLanes(segments, {
    primaryTrackId: primaryCandidate?.id,
    previousLanes: previous,
    previousNodeLanes: options.previousNodeLanes,
  });
  const segmentsWithLanes = segments.map((segment) => ({ ...segment, lane: segmentLanes.get(segment.id) ?? 0 }));
  const laneByNodeId = new Map<string, number>();
  const segmentsByTrack = new Map<string, Array<(typeof segmentsWithLanes)[number]>>();
  for (const segment of segmentsWithLanes) {
    segmentsByTrack.set(segment.trackId, [...(segmentsByTrack.get(segment.trackId) ?? []), segment]);
    for (const nodeId of segment.nodeIds ?? []) laneByNodeId.set(nodeId, segment.lane);
  }
  const trackLane = new Map<string, number>();
  const representativeLanes = new Set<number>();
  for (const candidate of ordered) {
    const candidateSegments = (segmentsByTrack.get(candidate.id) ?? []).slice().sort((a, b) => a.startRow - b.startRow || a.endRow - b.endRow || a.id.localeCompare(b.id));
    const lane = candidate.id === primaryCandidate?.id
      ? 0
      : candidateSegments[0]?.lane
        ?? (previous.get(candidate.id) !== undefined && (previous.get(candidate.id) as number) >= 1 ? previous.get(candidate.id) as number : undefined)
        ?? (() => {
          let fallback = 1;
          while (representativeLanes.has(fallback)) fallback += 1;
          return fallback;
        })();
    trackLane.set(candidate.id, lane);
    representativeLanes.add(lane);
  }
  const lanes = new Map(ordered.map((candidate) => [candidate.id, trackLane.get(candidate.id) as number]));
  const usedHues = new Set<number>();
  const familyColors = new Map<string, string>();
  const tracks: GraphTrack[] = ordered.map((candidate) => ({
    id: candidate.id,
    label: candidate.refs.map((ref) => refDisplay(ref)).join(' · '),
    family: candidate.family,
    kind: candidate.kind,
    lane: trackLane.get(candidate.id) as number,
    segments: (segmentsByTrack.get(candidate.id) ?? []).map((segment) => ({ startRow: segment.startRow, endRow: segment.endRow, lane: segment.lane })),
    color: familyColors.get(candidate.family) ?? (() => {
      const color = colorFor(candidate.family, usedHues);
      familyColors.set(candidate.family, color);
      return color;
    })(),
    refNames: candidate.refs.map((ref) => ref.fullName),
  }));
  const laidOut = initialAssignments.map(({ node, trackId }) => {
    const nodeLane = trackId ? laneByNodeId.get(node.id) ?? trackLane.get(trackId) ?? 0 : 0;
    if (!node.event) return { ...node, trackId, lane: nodeLane };
    const eventTrackId = eventTrackForRef(node.targetRef ?? node.event.refName) ?? trackId;
    const eventLane = eventTrackId ? laneByNodeId.get(node.id) ?? trackLane.get(eventTrackId) ?? nodeLane : nodeLane;
    // The event track is presentation metadata only.  It never contributes
    // a commit claim or a new GraphTrack/lane.
    return { ...node, trackId: eventTrackId, targetLaneId: eventTrackId ?? node.targetLaneId, lane: eventLane };
  });
  return { nodes: laidOut, tracks, lanes };
}

function refDisplay(ref: GitRef): string {
  return normalizeRefName(ref.shortName || ref.fullName);
}
