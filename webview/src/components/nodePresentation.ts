import { COMMIT_NODE_RADIUS } from '../../../src/layout/edgeRouter';
import type { GraphNode } from '../../../src/model/graphModel';

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

export interface UnsyncedNodeGradientStop {
  offset: string;
  opacity: number;
}

export interface UnsyncedNodeGradient {
  id: string;
  color: string;
  x1: '0%';
  y1: '0%';
  x2: '100%';
  y2: '100%';
  stops: UnsyncedNodeGradientStop[];
}

export function isUnsyncedCommit(node: Pick<GraphNode, 'kind' | 'syncState'>): boolean {
  return node.kind === 'commit' && (node.syncState === 'local-only' || node.syncState === 'remote-only');
}

/** Linked worktrees change the symbol of the real commit node, never the graph topology. */
export function isLinkedWorktreeCommit(node: Pick<GraphNode, 'kind' | 'linkedWorktrees'>): boolean {
  return (node.kind === 'commit' || node.kind === 'reflog-commit') && (node.linkedWorktrees?.length ?? 0) > 0;
}

export function isSelectedCommit(node: Pick<GraphNode, 'kind' | 'id' | 'oid'>, selected?: string): boolean {
  return Boolean(selected
    && (node.kind === 'commit' || node.kind === 'reflog-commit')
    && (node.id === `commit:${selected}` || node.oid === selected));
}

export function nodeFillStyle(fill?: string): { fill: string } | undefined {
  return fill ? { fill } : undefined;
}

/**
 * Returns the fixed diagonal fill used inside an unsynchronized commit node.
 * The fill axis runs from the upper-left to the lower-right so its blended
 * boundary runs from the lower-left to the upper-right. The node mask behind
 * this fill keeps the reduced-opacity side opaque against graph edges.
 */
export function unsyncedGradientForNode(node: Pick<GraphNode, 'kind' | 'syncState'>, color: string | undefined, id: string): UnsyncedNodeGradient | undefined {
  if (!isUnsyncedCommit(node) || !color) return undefined;
  return {
    id,
    color,
    x1: '0%',
    y1: '0%',
    x2: '100%',
    y2: '100%',
    stops: [
      { offset: '0%', opacity: 0.32 },
      { offset: '38%', opacity: 0.32 },
      { offset: '50%', opacity: 0.62 },
      { offset: '62%', opacity: 1 },
      { offset: '100%', opacity: 1 },
    ],
  };
}
