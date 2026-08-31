import type { GitCommit, GitRef, HistoryEvent } from '../git/gitTypes.js';
import type { GraphFactModel, GraphNode, GraphTrack } from '../model/graphModel.js';
import { branchFamilyForRef, normalizeRefName } from '../model/refDisplay.js';
import { branchFamilyHue, branchRouteColor } from '../utils/color.js';

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
  synthetic?: boolean;
}

function interval(segment: Pick<BranchSegment, 'startRow' | 'endRow'>): { startRow: number; endRow: number } {
  return segment.startRow <= segment.endRow
    ? { startRow: segment.startRow, endRow: segment.endRow }
    : { startRow: segment.endRow, endRow: segment.startRow };
}

function overlaps(a: Pick<BranchSegment, 'startRow' | 'endRow'>, b: Pick<BranchSegment, 'startRow' | 'endRow'>): boolean {
  const left = interval(a);
  const right = interval(b);
  if (left.endRow < right.startRow || right.endRow < left.startRow) return false;
  // A branch transition may touch a merge node at the end of one segment and
  // the start of the next one. The merge node itself is on the primary lane,
  // so sharing that boundary is safe. A zero-length segment still occupies
  // its row and conflicts with another zero-length segment there.
  if (left.startRow === left.endRow && right.startRow === right.endRow) return left.startRow === right.startRow;
  if (left.endRow === right.startRow || right.endRow === left.startRow) return false;
  return true;
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

function familyFor(ref: GitRef): string {
  return branchFamilyForRef(ref);
}

/**
 * Returns the shortest parent distance from a ref tip to each reachable
 * commit. This is a conservative fallback for incomplete fact models and for
 * grouping comparable local/remote tips; normal lane ownership is established
 * by the primary first-parent spine and merge side paths below.
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

function refTip(candidate: TrackCandidate | undefined, primary?: string): string | undefined {
  if (!candidate) return undefined;
  const normalizedPrimary = primary ? normalizeRefName(primary) : undefined;
  return candidate.refs.find((ref) => normalizedPrimary && normalizeRefName(ref.shortName || ref.fullName) === normalizedPrimary)?.oid
    ?? candidate.refs.find((ref) => ref.type === 'local')?.oid
    ?? candidate.refs[0]?.oid;
}

/**
 * Follows only the first parent. This is the stable spine of a checked-out
 * primary branch; merge side parents are handled as separate branch segments.
 */
function firstParentChain(tip: string | undefined, commits: Map<string, GitCommit>, stopTips = new Set<string>()): Set<string> {
  const chain = new Set<string>();
  let current = tip;
  while (current && !chain.has(current)) {
    chain.add(current);
    const parent = commits.get(current)?.parentOids[0];
    if (!parent || stopTips.has(parent)) break;
    current = parent;
  }
  return chain;
}

function firstParentDistance(tip: string | undefined, targetOid: string, commits: Map<string, GitCommit>): number {
  let distance = 0;
  let current = tip;
  while (current) {
    if (current === targetOid) return distance;
    current = commits.get(current)?.parentOids[0];
    distance += 1;
  }
  return Number.POSITIVE_INFINITY;
}

function candidateForSideRoot(rootOid: string, candidates: TrackCandidate[], primaryCandidate: TrackCandidate | undefined, commits: Map<string, GitCommit>): TrackCandidate | undefined {
  return candidates
    .filter((candidate) => candidate !== primaryCandidate && candidate.refs.some((ref) => Boolean(ref.oid && firstParentDistance(ref.oid, rootOid, commits) !== Number.POSITIVE_INFINITY)))
    .sort((a, b) => Math.min(...a.refs.map((ref) => firstParentDistance(ref.oid, rootOid, commits))) - Math.min(...b.refs.map((ref) => firstParentDistance(ref.oid, rootOid, commits)))
      || Number(b.kind === 'local') - Number(a.kind === 'local')
      || a.id.localeCompare(b.id))[0];
}

interface SideBranch {
  mergeOid: string;
  parentIndex: number;
  rootOid: string;
  candidate: TrackCandidate;
}

function historicalCandidate(id: string): TrackCandidate {
  return {
    id,
    family: 'historical',
    kind: 'local',
    refs: [],
    oids: new Set<string>(),
    synthetic: true,
  };
}

interface PreviousRoute {
  rootOid: string;
  candidate: TrackCandidate;
}

/**
 * Reset and amend move a ref away from a commit that may remain reachable
 * only through its reflog.  Keep that old first-parent path as an explicit
 * historical route so it gets its own side lane instead of being claimed by
 * the current branch's ancestry fallback.
 */
function previousRoutesFor(events: HistoryEvent[], nodes: GraphNode[]): PreviousRoute[] {
  const reflogOids = new Set(nodes
    .filter((node) => node.kind === 'reflog-commit' && node.oid)
    .map((node) => node.oid as string));
  const seenRoots = new Set<string>();
  const routes: PreviousRoute[] = [];
  for (const event of events) {
    if (event.type !== 'reset' && event.type !== 'amend') continue;
    const rootOid = event.fromOid;
    if (!rootOid || !reflogOids.has(rootOid) || seenRoots.has(rootOid)) continue;
    seenRoots.add(rootOid);
    routes.push({ rootOid, candidate: historicalCandidate(`history:previous:${event.id}`) });
  }
  return routes;
}

function sideBranchesFor(commits: Map<string, GitCommit>, nodes: GraphNode[], candidates: TrackCandidate[], primaryCandidate: TrackCandidate | undefined, primaryOids: Set<string>): SideBranch[] {
  const rowByOid = new Map(nodes.filter((node) => node.oid).map((node) => [node.oid as string, node.row ?? 0]));
  const orderOf = (commit: GitCommit): number => rowByOid.get(commit.oid) ?? -commit.committerDate;
  const mergeCommits = [...commits.values()]
    .filter((commit) => commit.parentOids.length > 1)
    // Process older merge side paths first. If a later merge's side path
    // passes through an earlier side branch, the earlier branch keeps its
    // identity and the later branch naturally becomes a transition into it.
    .sort((a, b) => orderOf(b) - orderOf(a) || a.oid.localeCompare(b.oid));
  const branches: SideBranch[] = [];
  for (const merge of mergeCommits) {
    for (let parentIndex = 1; parentIndex < merge.parentOids.length; parentIndex += 1) {
      const rootOid = merge.parentOids[parentIndex];
      if (primaryOids.has(rootOid)) continue;
      let candidate = candidateForSideRoot(rootOid, candidates, primaryCandidate, commits);
      if (!candidate) {
        candidate = historicalCandidate(`history:${merge.oid}:parent:${parentIndex}`);
        candidates.push(candidate);
      }
      branches.push({ mergeOid: merge.oid, parentIndex, rootOid, candidate });
    }
  }
  return branches;
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
  const normalizedPrimary = primary ? normalizeRefName(primary) : undefined;
  const defaultPrimaryFamily = normalizedPrimary ?? candidates.find((candidate) => candidate.family === 'main' || candidate.family === 'master')?.family;
  const primaryCandidate = candidates.find((candidate) => normalizedPrimary && candidate.refs.some((ref) => normalizeRefName(ref.shortName || ref.fullName) === normalizedPrimary))
    ?? candidates.find((candidate) => candidate.family === defaultPrimaryFamily);
  const previous = options.previousLanes ?? new Map<string, number>();

  const primaryTip = refTip(primaryCandidate, primary);
  const nonPrimaryTipOids = new Set(candidates
    .filter((candidate) => candidate !== primaryCandidate)
    .flatMap((candidate) => candidate.refs.map((ref) => ref.oid).filter((oid): oid is string => Boolean(oid))));
  const primaryOids = primaryCandidate ? firstParentChain(primaryTip, commits, nonPrimaryTipOids) : new Set<string>();
  const previousRoutes = previousRoutesFor(facts.events, facts.nodes);
  candidates.push(...previousRoutes.map((route) => route.candidate));
  const sideBranches = sideBranchesFor(commits, facts.nodes, candidates, primaryCandidate, primaryOids);
  const ordered = candidates.slice().sort((a, b) => {
    if (a.id === primaryCandidate?.id) return -1;
    if (b.id === primaryCandidate?.id) return 1;
    if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
    const oldA = previous.get(a.id);
    const oldB = previous.get(b.id);
    if (oldA !== undefined && oldB !== undefined) return oldA - oldB;
    if (oldA !== undefined) return -1;
    if (oldB !== undefined) return 1;
    if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  const trackByOid = new Map<string, string>();
  for (const oid of primaryOids) trackByOid.set(oid, primaryCandidate!.id);

  const assignFirstParentPath = (tip: string | undefined, trackId: string): void => {
    const visited = new Set<string>();
    let current = tip;
    while (current && !visited.has(current)) {
      visited.add(current);
      if (primaryOids.has(current)) break;
      const existing = trackByOid.get(current);
      if (existing && existing !== trackId) break;
      trackByOid.set(current, trackId);
      current = commits.get(current)?.parentOids[0];
    }
  };

  // Older side paths are assigned first so a later merge whose side parent
  // passes through them transitions into the already-established branch
  // segment instead of overwriting its track.
  for (const route of previousRoutes) assignFirstParentPath(route.rootOid, route.candidate.id);
  for (const branch of sideBranches) assignFirstParentPath(branch.rootOid, branch.candidate.id);
  // A live branch ref is useful for naming an otherwise unmerged branch, but
  // it cannot override the primary first-parent spine or an older side path.
  for (const candidate of candidates.filter((item) => item !== primaryCandidate && !item.synthetic)) {
    for (const ref of candidate.refs) assignFirstParentPath(ref.oid, candidate.id);
  }

  // Every real commit should normally be covered by the primary spine, a
  // merge side path, or a live branch path. Keep a conservative ancestry
  // fallback for incomplete/shallow fact models and reflog-only fixtures.
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
      // A checked-out branch is always a local ref. Do not let the remote
      // tracking ref become the Working Tree's lane anchor when it is ahead.
      const ref = refs.find((item) => item.type === 'local'
        && (item.shortName === branch || normalizeRefName(item.fullName) === branch));
      trackId = ref ? refTrack.get(ref.fullName) : undefined;
    }
    // Ref events must share the target ref's lane even when their destination
    // commit is claimed by another branch (for example a feature reset to a
    // main commit).  Resolve this before commit ancestry claims.
    if (!trackId && node.event?.refName) trackId = eventTrackForRef(node.targetRef ?? node.event.refName);
    if (!trackId && node.oid) trackId = trackByOid.get(node.oid) ?? trackForClaim(node.oid);
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
  const familyHues = new Map<string, number>();
  for (const family of [...new Set(candidates.map((candidate) => candidate.family))].filter((family) => family !== 'historical').sort()) {
    familyHues.set(family, branchFamilyHue(family, usedHues));
  }
  const routeIndexes = new Map<string, number>();
  const nextRouteByFamily = new Map<string, number>();
  for (const candidate of candidates.slice().sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))) {
    const routeIndex = nextRouteByFamily.get(candidate.family) ?? 0;
    routeIndexes.set(candidate.id, routeIndex);
    nextRouteByFamily.set(candidate.family, routeIndex + 1);
  }
  const tracks: GraphTrack[] = ordered.map((candidate) => ({
    id: candidate.id,
    label: candidate.refs.length ? candidate.refs.map((ref) => refDisplay(ref)).join(' · ') : 'Historical branch',
    family: candidate.family,
    kind: candidate.kind,
    lane: trackLane.get(candidate.id) as number,
    segments: (segmentsByTrack.get(candidate.id) ?? []).map((segment) => ({ startRow: segment.startRow, endRow: segment.endRow, lane: segment.lane })),
    color: candidate.family === 'historical'
      ? 'hsl(220 8% 62%)'
      : branchRouteColor(familyHues.get(candidate.family) ?? branchFamilyHue(candidate.family, usedHues), routeIndexes.get(candidate.id) ?? 0),
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
