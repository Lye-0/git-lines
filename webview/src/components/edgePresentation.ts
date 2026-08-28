import type { GraphEdge, GraphNode } from '../../../src/model/graphModel';

export interface EdgeGradient {
  id: string;
  sourceColor: string;
  targetColor: string;
}

export interface EdgeGradientInput {
  edge: Pick<GraphEdge, 'type' | 'annotation'>;
  source: Pick<GraphNode, 'kind'>;
  target: Pick<GraphNode, 'kind'>;
  sourceColor?: string;
  targetColor?: string;
  id: string;
}

/**
 * Returns a gradient only for a real commit-to-commit parent edge whose
 * branch colors differ.  Lane reuse is intentionally absent from this
 * decision: an X-coordinate change without a Git edge must not imply a
 * branch relationship.
 */
export function gradientForEdge(input: EdgeGradientInput): EdgeGradient | undefined {
  const { edge, source, target, sourceColor, targetColor } = input;
  if (edge.type !== 'parent' || edge.annotation) return undefined;
  if (source.kind !== 'commit' || target.kind !== 'commit') return undefined;
  if (!sourceColor || !targetColor || sourceColor === targetColor) return undefined;
  return { id: input.id, sourceColor, targetColor };
}
