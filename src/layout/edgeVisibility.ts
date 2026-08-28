import type { GraphEdge, GraphNode } from '../model/graphModel.js';
import type { EdgePath } from './layoutTypes.js';

/**
 * Keeps commit facts intact while ensuring legacy two-ended ref-event paths
 * cannot be rendered as a branch split. New events use one `ref-event`
 * annotation edge and do not enter this fallback.
 */
export function filterRenderableEdgePaths(paths: EdgePath[], edges: GraphEdge[], nodes: GraphNode[]): EdgePath[] {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return paths.filter((path) => {
    if (path.type !== 'history-event' || !path.id.endsWith(':from')) return true;
    const edge = edgeById.get(path.id);
    const source = edge ? nodeById.get(edge.fromNodeId) : undefined;
    const event = edge ? nodeById.get(edge.toNodeId) : undefined;
    if (!source || !event) return false;
    // Older fact models emitted a source and destination curve for one ref
    // move.  Suppress the source half in every case; a ref event is an
    // annotation, never a second commit edge.
    return false;
  });
}
