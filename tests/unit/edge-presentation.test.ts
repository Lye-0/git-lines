import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../src/model/graphModel.js';
import { gradientForEdge } from '../../webview/src/components/edgePresentation';

function node(id: string, kind: GraphNode['kind'], trackId: string, row: number, lane = 0): GraphNode {
  return { id, kind, trackId, row, lane, refIds: [], subject: id };
}

describe('edge presentation', () => {
  it('keeps same-color parent edges as solid strokes', () => {
    expect(gradientForEdge({
      edge: { type: 'parent' },
      source: node('source', 'commit', 'main', 0),
      target: node('target', 'commit', 'main', 1),
      sourceColor: '#2563eb',
      targetColor: '#2563eb',
      id: 'edge-gradient-same',
    })).toBeUndefined();
  });

  it('keeps source-to-target color order for a branch connector', () => {
    expect(gradientForEdge({
      edge: { type: 'parent' },
      source: node('main', 'commit', 'main', 0),
      target: node('feature', 'commit', 'feature', 1),
      sourceColor: '#2563eb',
      targetColor: '#16a34a',
      id: 'edge-gradient-branch',
    })).toEqual({ id: 'edge-gradient-branch', sourceColor: '#2563eb', targetColor: '#16a34a' });
  });

  it('supports the reverse color direction for a merge connector', () => {
    expect(gradientForEdge({
      edge: { type: 'parent' },
      source: node('feature', 'commit', 'feature', 0),
      target: node('merge', 'commit', 'main', 1),
      sourceColor: '#16a34a',
      targetColor: '#2563eb',
      id: 'edge-gradient-merge',
    })).toMatchObject({ sourceColor: '#16a34a', targetColor: '#2563eb' });
  });

  it('does not infer a gradient from lane reuse without a parent edge', () => {
    expect(gradientForEdge({
      edge: { type: 'working-tree' },
      source: node('old', 'commit', 'green', 0, 1),
      target: node('new', 'commit', 'purple', 1, 1),
      sourceColor: '#16a34a',
      targetColor: '#a855f7',
      id: 'edge-gradient-reuse',
    })).toBeUndefined();
  });

  it('uses the Git edge, not lane coordinates, when deciding to blend colors', () => {
    expect(gradientForEdge({
      edge: { type: 'parent' },
      source: node('old', 'commit', 'green', 0, 1),
      target: node('new', 'commit', 'purple', 1, 1),
      sourceColor: '#16a34a',
      targetColor: '#a855f7',
      id: 'edge-gradient-same-lane',
    })).toMatchObject({ sourceColor: '#16a34a', targetColor: '#a855f7' });
  });

  it.each([
    { type: 'working-tree' as const },
    { type: 'operation' as const },
    { type: 'history-event' as const, annotation: 'ref-event' as const },
  ])('keeps %s auxiliary edges out of gradients', (edge) => {
    expect(gradientForEdge({
      edge,
      source: node('source', 'commit', 'main', 0),
      target: node('target', 'commit', 'feature', 1),
      sourceColor: '#2563eb',
      targetColor: '#16a34a',
      id: 'edge-gradient-auxiliary',
    })).toBeUndefined();
  });

  it('keeps reflog-only nodes out of commit gradients', () => {
    expect(gradientForEdge({
      edge: { type: 'parent' },
      source: node('reflog', 'reflog-commit', 'old', 0),
      target: node('commit', 'commit', 'main', 1),
      sourceColor: '#a1a1aa',
      targetColor: '#2563eb',
      id: 'edge-gradient-reflog',
    })).toBeUndefined();
  });

});
