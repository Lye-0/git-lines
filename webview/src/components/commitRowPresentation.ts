import type { GraphNode } from '../../../src/model/graphModel';

export interface CommitRowPresentation {
  previousRoute: boolean;
  previousBadgeLabel?: string;
  historicalBadgeLabel?: string;
  metadataPlacement: 'content-start';
}

export function commitMetaText(oid: string, routeName: string | undefined, relative: string | undefined): string {
  return [oid.slice(0, 8), routeName, relative].filter(Boolean).join(' · ');
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
