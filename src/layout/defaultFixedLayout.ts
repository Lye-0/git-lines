import type { GraphFactModel, GraphNode, GraphTrack } from '../model/graphModel.js';
import type { DefaultBranchTarget } from '../model/defaultBranchResolver.js';
import type { ReflogEntry } from '../git/gitTypes.js';
import { branchCommitOrigins } from '../model/branchProtection.js';
import { branchPaletteColor, preferredBranchPaletteIndex, LIVE_BRANCH_PALETTE } from '../utils/color.js';
import type { computeLaneLayout } from './laneLayout.js';

type LaneResult = ReturnType<typeof computeLaneLayout>;

/** A separate placement policy. Legacy output is immutable and never receives
 * these lanes as its previous-layout state. Source-branch commits stay off 0. */
export function defaultFixedLayout(legacy: LaneResult, facts: GraphFactModel, target: DefaultBranchTarget, reflogs: ReflogEntry[]): LaneResult {
  const tracks = legacy.tracks.map((t) => ({ ...t }));
  const defaultTrack = tracks.find((t) => t.refNames.includes(target.refName));
  if (!defaultTrack) return legacy;
  const origins = branchCommitOrigins(reflogs, facts.commits);
  const forOrigin = (ref: string): GraphTrack => {
    const existing = tracks.find((t) => t.refNames.includes(ref) || t.id === `protected:${ref}`);
    if (existing) return existing;
    const family = ref.slice('refs/heads/'.length);
    let color = branchPaletteColor(preferredBranchPaletteIndex(family));
    for (let i = 0; i < LIVE_BRANCH_PALETTE.length && tracks.some((t) => t.color === color); i++) color = branchPaletteColor(i);
    const track: GraphTrack = { id: `protected:${ref}`, label: family, family, kind: 'local', lane: 1, color, refNames: [] };
    tracks.push(track); return track;
  };
  const nodes = legacy.nodes.map((n) => {
    const origin = n.oid && (n.kind === 'commit' || n.kind === 'reflog-commit') ? origins.get(n.oid) : undefined;
    // Preserve all existing non-default route identities. Only separate
    // commits the legacy policy absorbed into the default route.
    if (n.trackId === defaultTrack.id && origin && origin !== `refs/heads/${target.branch}` && origin !== target.refName) {
      const track = forOrigin(origin);
      return { ...n, trackId: track.id, lane: track.lane };
    }
    return { ...n };
  });
  if (nodes.every((n, i) => n.trackId === legacy.nodes[i].trackId && (n.trackId === defaultTrack.id ? n.lane === 0 : (n.lane ?? 0) > 0))) return legacy;

  type Group = { key: string; trackId: string; preferred: number; nodes: GraphNode[]; start: number; end: number; lane?: number };
  const groups = new Map<string, Group>();
  const groupByNode = new Map<string, Group>();
  for (const n of nodes) {
    const key = `${n.trackId}:${n.lane}`;
    const g = groups.get(key) ?? { key, trackId: n.trackId ?? '', preferred: n.lane ?? 1, nodes: [], start: n.row ?? 0, end: n.row ?? 0 };
    g.nodes.push(n); g.start = Math.min(g.start, n.row ?? 0); g.end = Math.max(g.end, n.row ?? 0);
    groups.set(key, g); groupByNode.set(n.id, g);
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of facts.edges) {
    const a = groupByNode.get(edge.fromNodeId), b = groupByNode.get(edge.toNodeId);
    const source = nodeById.get(edge.fromNodeId), dest = nodeById.get(edge.toNodeId);
    if (!a || !b || !source || !dest) continue;
    for (const g of [a, b]) { g.start = Math.min(g.start, source.row ?? 0, dest.row ?? 0); g.end = Math.max(g.end, source.row ?? 0, dest.row ?? 0); }
  }
  const occupied = new Map<number, Group[]>();
  for (const g of [...groups.values()].sort((a, b) => a.start - b.start || a.preferred - b.preferred || a.key.localeCompare(b.key))) {
    let lane = g.trackId === defaultTrack.id ? 0 : Math.max(1, g.preferred);
    if (lane !== 0) {
      while ((occupied.get(lane) ?? []).some((other) => other.trackId !== g.trackId && other.end >= g.start && g.end >= other.start)) lane++;
      occupied.set(lane, [...(occupied.get(lane) ?? []), g]);
    }
    g.lane = lane; for (const n of g.nodes) n.lane = lane;
  }
  for (const track of tracks) {
    const segments = [...groups.values()].filter((g) => g.trackId === track.id).map((g) => ({ startRow: g.start, endRow: g.end, lane: g.lane! }));
    track.segments = segments;
    track.lane = track.id === defaultTrack.id ? 0 : segments[0]?.lane ?? Math.max(1, track.lane);
  }
  return { nodes, tracks, lanes: new Map(tracks.map((t) => [t.id, t.lane])) };
}
