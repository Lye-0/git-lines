import type { GraphFactModel, GraphTrack } from '../model/graphModel.js';
import type { ReflogEntry } from '../git/gitTypes.js';
import { branchCommitOrigins } from '../model/branchProtection.js';
import { branchPaletteColor, preferredBranchPaletteIndex, LIVE_BRANCH_PALETTE } from '../utils/color.js';
import type { computeLaneLayout } from './laneLayout.js';

/** Preserve proven source routes imported by FF without changing unrelated placement. */
export function fastForwardLayout(legacy: ReturnType<typeof computeLaneLayout>, facts: GraphFactModel, logs: ReflogEntry[]): ReturnType<typeof computeLaneLayout> {
  const commits = new Map(facts.commits.map((c) => [c.oid, c]));
  const ancestors = (oid: string) => {
    const result = new Set<string>(), pending = [oid];
    while (pending.length) {
      const next = pending.pop()!;
      if (result.has(next)) continue;
      result.add(next);
      pending.push(...(commits.get(next)?.parentOids ?? []));
    }
    return result;
  };
  const imports = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const log of logs) {
    if (!log.previousOid || !log.refName.startsWith('refs/heads/') || !/: Fast-forward$/i.test(log.subject)) continue;
    const key = `${log.refName}:${log.previousOid}:${log.newOid}`;
    if (!commits.has(log.newOid) || seen.has(key)) continue;
    seen.add(key);
    const before = ancestors(log.previousOid), after = ancestors(log.newOid);
    // Partial history must not turn an unverified movement into an FF range.
    if (!after.has(log.previousOid)) continue;
    const imported = imports.get(log.refName) ?? new Set<string>();
    for (const oid of after) if (!before.has(oid)) imported.add(oid);
    imports.set(log.refName, imported);
  }
  if (!imports.size) return legacy;
  const origins = branchCommitOrigins(logs, facts.commits);
  const tracks = legacy.tracks.map((t) => ({ ...t }));
  const changes = new Map<string, string>();
  for (const node of legacy.nodes) {
    if (!node.oid || (node.kind !== 'commit' && node.kind !== 'reflog-commit')) continue;
    const origin = origins.get(node.oid), track = tracks.find((t) => t.id === node.trackId);
    if (origin && track && !track.refNames.includes(origin)
      && track.refNames.some((ref) => imports.get(ref)?.has(node.oid!))) changes.set(node.id, origin);
  }
  if (!changes.size) return legacy;
  const nodes = legacy.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Reserve the entire connected row interval, including transitions, so an
  // imported route cannot run through unrelated nodes or another route.
  for (const origin of new Set(changes.values())) {
    let track = tracks.find((t) => t.refNames.includes(origin) || t.id === `protected:${origin}`);
    if (!track) {
      const family = origin.slice('refs/heads/'.length);
      let color = branchPaletteColor(preferredBranchPaletteIndex(family));
      for (let i = 0; i < LIVE_BRANCH_PALETTE.length && tracks.some((t) => t.color === color); i++) color = branchPaletteColor(i);
      track = { id: `protected:${origin}`, label: family, family, kind: 'local', lane: 1,
        color, refNames: [] } satisfies GraphTrack;
      tracks.push(track);
    }
    const members = nodes.filter((n) => changes.get(n.id) === origin || n.trackId === track.id);
    const ids = new Set(members.map((n) => n.id));
    const connected = new Set(facts.edges.filter((e) => ids.has(e.fromNodeId) || ids.has(e.toNodeId)).flatMap((e) => [e.fromNodeId, e.toNodeId]));
    const rows = nodes.filter((n) => ids.has(n.id) || connected.has(n.id)).map((n) => n.row ?? 0);
    const startRow = Math.min(...rows), endRow = Math.max(...rows);
    let lane = Math.max(1, track.lane);
    const conflicts = () => nodes.some((n) => !ids.has(n.id) && n.lane === lane && (n.row ?? 0) >= startRow && (n.row ?? 0) <= endRow)
      || facts.edges.some((e) => {
        const a = byId.get(e.fromNodeId), b = byId.get(e.toNodeId);
        return a && b && !ids.has(a.id) && !ids.has(b.id) && (a.lane === lane || b.lane === lane)
          && Math.max(a.row ?? 0, b.row ?? 0) >= startRow && Math.min(a.row ?? 0, b.row ?? 0) <= endRow;
      });
    while (conflicts()) lane++;
    for (const node of members) { node.trackId = track.id; node.lane = lane; }
    track.lane = lane; track.segments = [{ startRow, endRow, lane }];
  }
  return { nodes, tracks, lanes: new Map(tracks.map((t) => [t.id, t.lane])) };
}
