import type { GraphEdge, GraphNode, GraphTrack } from '../../../src/model/graphModel';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { branchColor, HISTORICAL_ROUTE_COLOR, isSafeLiveBranchColor } from '../../../src/utils/color';
import { normalizeRefName } from '../../../src/model/refDisplay';

type GraphColorContext = Pick<GraphLayout, 'nodes' | 'edges' | 'tracks'>;

export interface GraphColorResolver {
  colorForNode(node: GraphNode): string;
  colorForEdge(edge: GraphEdge, endpoint?: 'source' | 'target'): string;
}

function sameRefName(first: string, second: string): boolean {
  return first === second || normalizeRefName(first) === normalizeRefName(second);
}

function safeTrackColor(track: GraphTrack): string {
  if (track.family === 'historical') return HISTORICAL_ROUTE_COLOR;
  return isSafeLiveBranchColor(track.color) ? track.color : branchColor(track.family);
}

function isHistoricalNode(node: GraphNode, track: GraphTrack | undefined): boolean {
  return node.previousRoute === true
    || node.kind === 'reflog-commit'
    || node.kind === 'history-boundary'
    || track?.family === 'historical';
}

/**
 * Resolves graph colors defensively at the rendering boundary. A live node or
 * edge must never fall through to the muted UI color: if its track is absent,
 * use a directly referenced live track, then a nearby live route, and finally
 * a deterministic live representative color.
 */
export function createGraphColorResolver(context: GraphColorContext): GraphColorResolver {
  const trackById = new Map(context.tracks.map((track) => [track.id, track]));
  const nodeById = new Map(context.nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, string[]>();
  for (const edge of context.edges) {
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) continue;
    adjacent.set(edge.fromNodeId, [...(adjacent.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    adjacent.set(edge.toNodeId, [...(adjacent.get(edge.toNodeId) ?? []), edge.fromNodeId]);
  }

  const liveTracks = context.tracks.filter((track) => track.family !== 'historical');
  const fallbackLiveColor = liveTracks
    .slice()
    .sort((a, b) => Number(b.kind === 'local') - Number(a.kind === 'local') || a.id.localeCompare(b.id))[0];
  const fallbackColor = fallbackLiveColor ? safeTrackColor(fallbackLiveColor) : branchColor('main');

  const directTrackForNode = (node: GraphNode): GraphTrack | undefined => {
    const byId = node.trackId ? trackById.get(node.trackId) : undefined;
    if (byId) return byId;
    const refNames = [
      ...(node.refBadges?.map((badge) => badge.fullName) ?? []),
      ...node.refIds,
      ...(node.targetRef ? [node.targetRef] : []),
    ];
    if (!refNames.length) return undefined;
    return context.tracks.find((track) => track.refNames.some((trackRef) => refNames.some((ref) => sameRefName(trackRef, ref))));
  };

  const directColorForNode = (node: GraphNode): { color: string; track: GraphTrack } | undefined => {
    const track = directTrackForNode(node);
    if (!track) return undefined;
    return { color: safeTrackColor(track), track };
  };

  const cachedColors = new Map<string, string>();
  const resolving = new Set<string>();

  const colorForNode = (node: GraphNode): string => {
    const cached = cachedColors.get(node.id);
    if (cached) return cached;
    const direct = directColorForNode(node);
    if (isHistoricalNode(node, direct?.track)) {
      cachedColors.set(node.id, HISTORICAL_ROUTE_COLOR);
      return HISTORICAL_ROUTE_COLOR;
    }
    if (direct) {
      cachedColors.set(node.id, direct.color);
      return direct.color;
    }

    if (!resolving.has(node.id)) {
      resolving.add(node.id);
      const seen = new Set<string>([node.id]);
      const queue = (adjacent.get(node.id) ?? []).slice().sort((a, b) => {
        const first = nodeById.get(a);
        const second = nodeById.get(b);
        return (first?.row ?? Number.POSITIVE_INFINITY) - (second?.row ?? Number.POSITIVE_INFINITY) || a.localeCompare(b);
      }).map((id) => ({ id, distance: 1 }));
      let best: { color: string; distance: number; kindPriority: number; family: string; id: string } | undefined;
      while (queue.length) {
        const current = queue.shift()!;
        if (seen.has(current.id)) continue;
        seen.add(current.id);
        const candidate = nodeById.get(current.id);
        if (!candidate || isHistoricalNode(candidate, directColorForNode(candidate)?.track)) continue;
        const candidateDirect = directColorForNode(candidate);
        if (candidateDirect) {
          const priority = { color: candidateDirect.color, distance: current.distance, kindPriority: candidateDirect.track.kind === 'local' ? 0 : 1, family: candidateDirect.track.family, id: candidate.id };
          if (!best || priority.distance < best.distance
            || (priority.distance === best.distance && priority.kindPriority < best.kindPriority)
            || (priority.distance === best.distance && priority.kindPriority === best.kindPriority && priority.family.localeCompare(best.family) < 0)
            || (priority.distance === best.distance && priority.kindPriority === best.kindPriority && priority.family === best.family && priority.id.localeCompare(best.id) < 0)) best = priority;
        }
        for (const neighbor of (adjacent.get(current.id) ?? []).slice().sort()) {
          if (!seen.has(neighbor)) queue.push({ id: neighbor, distance: current.distance + 1 });
        }
      }
      resolving.delete(node.id);
      if (best) {
        cachedColors.set(node.id, best.color);
        return best.color;
      }
    }
    cachedColors.set(node.id, fallbackColor);
    return fallbackColor;
  };

  const colorForEdge = (edge: GraphEdge, endpoint: 'source' | 'target' = 'source'): string => {
    const source = nodeById.get(edge.fromNodeId);
    const target = nodeById.get(edge.toNodeId);
    const edgeTrack = edge.trackId ? trackById.get(edge.trackId) : undefined;
    if (edgeTrack?.family === 'historical') return HISTORICAL_ROUTE_COLOR;
    if (edgeTrack) return safeTrackColor(edgeTrack);
    const sourceDirect = source ? directColorForNode(source) : undefined;
    const targetDirect = target ? directColorForNode(target) : undefined;
    if (source && isHistoricalNode(source, sourceDirect?.track)) return HISTORICAL_ROUTE_COLOR;
    if (target && isHistoricalNode(target, targetDirect?.track)) return HISTORICAL_ROUTE_COLOR;
    const selected = endpoint === 'target' ? target : source;
    return selected ? colorForNode(selected) : fallbackColor;
  };

  return { colorForNode, colorForEdge };
}
