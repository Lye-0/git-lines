import type { GraphHeadState, GraphNode } from '../../../src/model/graphModel';

/** Keep every DAG endpoint, but show the shared unread-history notice once. */
export function commitRowsForDisplay(nodes: GraphNode[]): GraphNode[] {
  let hasUnreadHistoryNotice = false;
  return nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0)).filter((node) => {
    // Shallow-clone boundaries have no OID and retain their distinct notice.
    if (node.kind !== 'history-boundary' || !node.oid) return true;
    if (hasUnreadHistoryNotice) return false;
    hasUnreadHistoryNotice = true;
    return true;
  });
}

export interface CommitRowPresentation {
  previousRoute: boolean;
  previousBadgeLabel?: string;
  historicalBadgeLabel?: string;
  metadataPlacement: 'content-start';
}

export function commitMetaText(oid: string, routeName: string | undefined, relative: string | undefined, headState?: GraphHeadState): string {
  const headLabel = headState === 'detached' ? 'HEAD (detached)' : headState === 'attached' ? 'HEAD' : undefined;
  // Preserve the route column for the current detached HEAD even when the
  // live route has no branch ref.  Do not use filter(Boolean): the empty
  // string is an intentional column in "hash ·  · time · HEAD (detached)".
  const routeColumn = routeName ?? (headLabel ? '' : undefined);
  return [oid.slice(0, 8), routeColumn, relative, headLabel]
    .filter((value): value is string => value !== undefined)
    .join(' · ');
}

/** Keeps the visual contract for current and historical commit rows explicit. */
export function commitRowPresentation(node: Pick<GraphNode, 'kind' | 'previousRoute' | 'historicalKind' | 'historicalRouteHead'>): CommitRowPresentation {
  const previousRoute = node.previousRoute === true;
  const presentation: CommitRowPresentation = {
    previousRoute,
    previousBadgeLabel: previousRoute ? 'PREVIOUS' : undefined,
    // The metadata is a sibling of the heading inside row-text, so it starts
    // at the same content column even when the heading has a badge.
    metadataPlacement: 'content-start',
  };
  if (!previousRoute && node.historicalRouteHead && node.historicalKind === 'deleted-branch') presentation.historicalBadgeLabel = 'DELETED BRANCH';
  if (!previousRoute && node.historicalRouteHead && node.historicalKind === 'unreferenced') presentation.historicalBadgeLabel = 'UNREFERENCED';
  return presentation;
}
