import type { GraphNode } from '../model/graphModel.js';

export const COMMIT_NODE_RADIUS = 6.5;
/** Local SVG origin of a node group after `translate(pointForNode)`. */
export const NODE_LOCAL_CENTER = { x: 0, y: 0 } as const;
export const SMALL_COMMIT_NODE_RADIUS = 4;
export const NODE_SELECTION_RING_RADIUS = 10;

export type NodeMarkShape = 'dot' | 'square' | 'hollow' | 'diamond' | 'text';

export interface NodeMarkGeometry {
  center: { x: number; y: number };
  shape: NodeMarkShape;
  radius: number;
  text?: string;
}

export interface NodeRingGeometry {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Final on-node mark geometry.  Selection / hover / focus decorations must
 * read this center instead of inventing a row-based offset of their own.
 */
export function nodeMarkGeometry(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): NodeMarkGeometry {
  const center = { x: NODE_LOCAL_CENTER.x, y: NODE_LOCAL_CENTER.y };
  if (isLinkedWorktreeCommit(node)) return { center, shape: 'square', radius: COMMIT_NODE_RADIUS };
  if (node.kind === 'commit') return { center, shape: 'dot', radius: COMMIT_NODE_RADIUS };
  if (node.kind === 'working-tree' || node.kind === 'operation') return { center, shape: 'hollow', radius: COMMIT_NODE_RADIUS };
  if (node.kind === 'fast-forward-event' || node.kind === 'history-event') return { center, shape: 'diamond', radius: COMMIT_NODE_RADIUS };
  if (node.kind === 'reflog-commit') return { center, shape: 'dot', radius: SMALL_COMMIT_NODE_RADIUS };
  return { center, shape: 'text', radius: 6, text: '⋯' };
}

export function nodeRingGeometry(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): NodeRingGeometry {
  const { center } = nodeMarkGeometry(node);
  return { cx: center.x, cy: center.y, r: NODE_SELECTION_RING_RADIUS };
}

/** Linked worktrees change the symbol of the real commit node, never the graph topology. */
export function isLinkedWorktreeCommit(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): boolean {
  return (node.kind === 'commit' || node.kind === 'reflog-commit') && (node.linkedWorktrees?.length ?? 0) > 0;
}

