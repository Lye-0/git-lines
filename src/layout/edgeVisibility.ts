import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { EdgePath } from './layoutTypes.js';

/**
 * Keeps the fact-model edges intact while removing only visual ref-event
 * connectors that duplicate a normal rail on the same lane.
 */
export function filterRenderableEdgePaths(paths: EdgePath[], edges: GraphEdge[], nodes: GraphNode[]): EdgePath[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return paths.filter((path) => {
    if (path.type !== 'history-event' || !path.id.endsWith(':from')) return true;
    const edge = edgeById.get(path.id);
    const source = edge ? nodeById.get(edge.fromNodeId) : undefined;
    const event = edge ? nodeById.get(edge.toNodeId) : undefined;
    if (!source || !event) return true;
    return source.lane !== event.lane;
  });
}
