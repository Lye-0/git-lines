import type { GraphLayout } from '../../../src/layout/layoutTypes';
import type { GraphNode, RefMovementRelation } from '../../../src/model/graphModel';
import type { GraphRefBadge } from '../../../src/model/refDisplay';

export interface GraphSideRefEndpoint {
  nodeId: string;
  oid: string;
  badge: GraphRefBadge;
  ghost: boolean;
}

function badgeForMovement(node: GraphNode, refName: string): { badge: GraphRefBadge; ghost: boolean } | undefined {
  const current = (node.refBadges ?? []).find((badge) => badge.fullName === refName);
  if (current) return { badge: current, ghost: false };
  const ghost = (node.ghostRefBadges ?? []).find((badge) => badge.fullName === refName);
  if (ghost) return { badge: ghost, ghost: true };
  return undefined;
}

/**
 * Visible Reset / Branch move endpoints whose badges belong beside the commit
 * node in the graph column.  Live refs that are not this movement's endpoint
 * stay on the message row.
 */
export function graphSideRefEndpoints(nodes: GraphNode[], relations: RefMovementRelation[]): GraphSideRefEndpoint[] {
  const byOid = new Map(nodes
    .filter((node) => (node.kind === 'commit' || node.kind === 'reflog-commit') && node.oid)
    .map((node) => [node.oid as string, node]));
  const seen = new Set<string>();
  const endpoints: GraphSideRefEndpoint[] = [];
  for (const relation of relations) {
    for (const oid of [relation.fromOid, relation.toOid]) {
      const node = byOid.get(oid);
      if (!node) continue;
      const match = badgeForMovement(node, relation.refName);
      if (!match) continue;
      const key = `${node.id}\0${match.badge.fullName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push({ nodeId: node.id, oid, badge: match.badge, ghost: match.ghost });
    }
  }
  return endpoints.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.badge.fullName.localeCompare(b.badge.fullName));
}

export function graphSideRefFullNamesForNode(node: GraphNode, relations: RefMovementRelation[]): Set<string> {
  return new Set(graphSideRefEndpoints([node], relations).map((endpoint) => endpoint.badge.fullName));
}

export function messageSideRefBadges(node: GraphNode, graphSideFullNames: Set<string>): GraphRefBadge[] {
  return (node.refBadges ?? []).filter((badge) => !graphSideFullNames.has(badge.fullName));
}

export function messageSideGhostRefBadges(node: GraphNode, graphSideFullNames: Set<string>): GraphRefBadge[] {
  return (node.ghostRefBadges ?? []).filter((badge) => !graphSideFullNames.has(badge.fullName));
}

export function layoutGraphSideRefEndpoints(layout: Pick<GraphLayout, 'nodes' | 'refMovementRelations'>): GraphSideRefEndpoint[] {
  return graphSideRefEndpoints(layout.nodes, layout.refMovementRelations ?? []);
}
