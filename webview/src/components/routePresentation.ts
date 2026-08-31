import type { GraphNode, GraphTrack } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';

type RouteTrack = Pick<GraphTrack, 'id' | 'label' | 'refNames'>;

/**
 * Returns the branch name that owns a visual route. Local refs are preferred
 * over remote-tracking refs because the latter are badges for the same route,
 * not the route's primary branch name.
 */
export function routeNameForTrack(track: RouteTrack | undefined): string | undefined {
  if (!track) return undefined;
  const localRef = track.refNames.find((refName) => refName.startsWith('refs/heads/'));
  if (localRef) return normalizeRefName(localRef);
  const remoteRef = track.refNames.find((refName) => refName.startsWith('refs/remotes/'));
  if (remoteRef) return normalizeRefName(remoteRef);
  return track.label || undefined;
}

/** Uses the route assigned by the lane layout, never Git branch containment. */
export function routeNameForNode(node: Pick<GraphNode, 'trackId'> | undefined, tracks: ReadonlyArray<RouteTrack>): string | undefined {
  if (!node?.trackId) return undefined;
  return routeNameForTrack(tracks.find((track) => track.id === node.trackId));
}
