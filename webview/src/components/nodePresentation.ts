import type { GraphNode } from '../../../src/model/graphModel';

export interface UnsyncedNodeGradientStop {
  offset: string;
  opacity: number;
}

export interface UnsyncedNodeGradient {
  id: string;
  color: string;
  x1: '0%';
  y1: '100%';
  x2: '100%';
  y2: '0%';
  stops: UnsyncedNodeGradientStop[];
}

export function isUnsyncedCommit(node: Pick<GraphNode, 'kind' | 'syncState'>): boolean {
  return node.kind === 'commit' && (node.syncState === 'local-only' || node.syncState === 'remote-only');
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
 * The lower-left side stays visible at reduced opacity and the upper-right
 * side keeps the branch color at full opacity, with a short blended boundary.
 */
export function unsyncedGradientForNode(node: Pick<GraphNode, 'kind' | 'syncState'>, color: string | undefined, id: string): UnsyncedNodeGradient | undefined {
  if (!isUnsyncedCommit(node) || !color) return undefined;
  return {
    id,
    color,
    x1: '0%',
    y1: '100%',
    x2: '100%',
    y2: '0%',
    stops: [
      { offset: '0%', opacity: 0.32 },
      { offset: '38%', opacity: 0.32 },
      { offset: '50%', opacity: 0.62 },
      { offset: '62%', opacity: 1 },
      { offset: '100%', opacity: 1 },
    ],
  };
}
