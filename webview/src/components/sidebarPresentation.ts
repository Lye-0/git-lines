import type { GraphLayout } from '../../../src/layout/layoutTypes';
import type { GraphNode } from '../../../src/model/graphModel';
import { pointForNode } from '../../../src/layout/edgeRouter';
import { nodeRingGeometry } from '../../../src/layout/nodeGeometry';

/** Per-row content origins; continuing DAG lines must remain outside text. */
export function sidebarRowOffsets(layout: GraphLayout, graphWidth: number): Map<string, number> {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const spans = (layout.edgePaths ?? []).flatMap((path) => {
    const edge = edgeById.get(path.edgeId ?? path.id);
    const from = byId.get(path.fromNodeId ?? edge?.fromNodeId ?? ''), to = byId.get(path.toNodeId ?? edge?.toNodeId ?? '');
    if (!from || !to) return [];
    // DAG paths use absolute M/L/C commands. Their control hull conservatively
    // bounds the route, including any node-avoidance detour.
    const numbers = (path.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    return [{ first: Math.min(from.row ?? 0, to.row ?? 0), last: Math.max(from.row ?? 0, to.row ?? 0),
      right: Math.max(0, ...numbers.filter((_, index) => index % 2 === 0)) }];
  });
  const overlaySpans = [...(layout.historyRelationPaths ?? []), ...(layout.refMovementPaths ?? []), ...(layout.rebaseRelationPaths ?? []), ...(layout.cherryPickGroupPaths ?? []), ...(layout.rewriteCollapsePaths ?? [])].flatMap((path) => {
    const from = byId.get(path.sourceNodeId), to = byId.get(path.targetNodeId);
    return from && to ? [{ first: Math.min(from.row ?? 0, to.row ?? 0), last: Math.max(from.row ?? 0, to.row ?? 0) }] : [];
  });
  const groupedOverlay = Boolean(layout.rebaseGroupOutlines?.length || layout.cherryPickGroupOutlines?.length || layout.rewriteCollapseOutlines?.length);
  return new Map(layout.nodes.map((node: GraphNode) => {
    if (groupedOverlay || overlaySpans.some((span) => span.first <= (node.row ?? 0) && span.last >= (node.row ?? 0))
      || !['commit', 'reflog-commit', 'history-boundary', 'working-tree'].includes(node.kind)) return [node.id, graphWidth];
    let right = pointForNode(node, layout).x;
    for (const span of spans) if (span.first <= (node.row ?? 0) && span.last >= (node.row ?? 0)) right = Math.max(right, span.right);
    return [node.id, right + nodeRingGeometry(node).r + 4];
  }));
}

export function sidebarPopoverPosition(top: number, bottom: number, viewportHeight: number) {
  const below = Math.max(0, viewportHeight - bottom - 12);
  const above = Math.max(0, top - 12);
  const upwards = below < 240 && above > below;
  const height = Math.max(0, Math.min(480, Math.max(80, upwards ? above : below), viewportHeight - 16));
  return { top: Math.max(8, Math.min(upwards ? top - height - 6 : bottom + 6, viewportHeight - height - 8)), maxHeight: height, upwards };
}
