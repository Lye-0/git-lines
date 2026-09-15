import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { BranchIntegration } from '../model/branchIntegration.js';
import type { EdgePath } from './layoutTypes.js';
import { routeEdges, type EdgeRouterOptions } from './edgeRouter.js';

export interface BranchIntegrationPath {
  eventId: string;
  role: 'continuation' | 'intake';
  fromNodeId: string;
  toNodeId: string;
  d: string;
}

/** Reserve the existing FF glyph as the receiving branch's junction. */
export function integrationEventIds(nodes: GraphNode[], integrations: BranchIntegration[]): Set<string> {
  return new Set(integrations.filter(i => {
    const event = nodes.find(n => n.id === i.eventId);
    const before = nodes.find(n => n.kind === 'commit' && n.oid === i.beforeOid);
    const tip = nodes.find(n => n.kind === 'commit' && n.oid === i.tipOid);
    return event && before && tip && event.trackId === before.trackId && event.trackId !== tip.trackId
      && (event.row ?? 0) < (tip.row ?? 0) && (tip.row ?? 0) < (before.row ?? 0);
  }).map(i => i.eventId));
}

export function routeBranchIntegrations(nodes: GraphNode[], edges: GraphEdge[], integrations: BranchIntegration[],
  original: EdgePath[], options: EdgeRouterOptions): { edgePaths: EdgePath[]; paths: BranchIntegrationPath[] } {
  const active = integrationEventIds(nodes, integrations);
  const byId = new Map(nodes.map(n => [n.id, n]));
  let edgePaths = original;
  const paths: BranchIntegrationPath[] = [];
  // Reuse the bounded obstacle-aware geometry, but never add these routing
  // requests to GraphFactModel.edges: they are not Git parents.
  const curve = (from: GraphNode, to: GraphNode) => routeEdges(nodes,
    [{ id: 'branch-flow', type: 'parent', fromNodeId: from.id, toNodeId: to.id }], options)[0].d;
  for (const integration of integrations.filter(i => active.has(i.eventId))) {
    const event = byId.get(integration.eventId)!;
    const before = nodes.find(n => n.kind === 'commit' && n.oid === integration.beforeOid)!;
    const tip = nodes.find(n => n.kind === 'commit' && n.oid === integration.tipOid)!;
    const intake = curve(event, tip);
    paths.push({ eventId: event.id, role: 'continuation', fromNodeId: event.id, toNodeId: before.id, d: curve(event, before) },
      { eventId: event.id, role: 'intake', fromNodeId: event.id, toNodeId: tip.id, d: intake });
    // The original checkout/parent fact still ends at tip. Route its visual
    // path THROUGH the junction instead of bypassing the intake. The intake
    // stroke is painted solid over the coincident checkout dashes.
    const connectors = edges.filter(e => {
      const from = byId.get(e.fromNodeId);
      return from && e.toNodeId === tip.id && from.trackId === event.trackId && (from.row ?? 0) < (event.row ?? 0)
        && (e.type === 'working-tree' || (e.type === 'parent' && from.commit?.parentOids[0] === tip.oid));
    });
    const ids = new Set(connectors.map(e => e.id));
    edgePaths = edgePaths.filter(p => !ids.has(p.edgeId ?? p.id) && p.id !== `${event.id}:annotation`);
    for (const connector of connectors) edgePaths.push({ id: connector.id, edgeId: connector.id, type: connector.type,
      fromNodeId: connector.fromNodeId, toNodeId: connector.toNodeId,
      d: `${curve(byId.get(connector.fromNodeId)!, event)} ${intake.replace(/^M [^C]+/, '')}` });
  }
  return { edgePaths, paths };
}
