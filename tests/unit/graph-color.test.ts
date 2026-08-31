import { describe, expect, it } from 'vitest';
import { branchPaletteColor, HISTORICAL_ROUTE_COLOR } from '../../src/utils/color.js';
import { createGraphColorResolver } from '../../webview/src/components/graphColor';
import type { GraphEdge, GraphNode, GraphTrack } from '../../src/model/graphModel.js';

function hueOf(color: string): number {
  const match = color.match(/^hsl\((\d+)/);
  if (!match) throw new Error(`Unexpected HSL color: ${color}`);
  return Number(match[1]);
}

function node(id: string, row: number, trackId?: string, kind: GraphNode['kind'] = 'commit', previousRoute = false): GraphNode {
  return { id, kind, row, trackId, previousRoute, refIds: [], oid: id.repeat(40).slice(0, 40), subject: id };
}

describe('graph live color resolution', () => {
  const featureColor = branchPaletteColor(1, 0);
  const aliceColor = branchPaletteColor(1, 1);
  const historicalColor = HISTORICAL_ROUTE_COLOR;

  function fixture() {
    const nodes = [
      node('local', 0, 'feature-local'),
      node('alice', 1, 'feature-alice'),
      node('shared', 2),
      node('previous', 3, 'historical', 'reflog-commit', true),
    ];
    const edges: GraphEdge[] = [
      { id: 'local-shared', type: 'parent', fromNodeId: 'local', toNodeId: 'shared' },
      { id: 'alice-shared', type: 'parent', fromNodeId: 'alice', toNodeId: 'shared' },
      { id: 'previous-shared', type: 'parent', fromNodeId: 'previous', toNodeId: 'shared' },
    ];
    const tracks: GraphTrack[] = [
      { id: 'feature-local', label: 'feature', family: 'feature', kind: 'local', lane: 1, color: featureColor, refNames: ['refs/heads/feature'] },
      { id: 'feature-alice', label: 'alice/feature', family: 'feature', kind: 'remote', lane: 2, color: aliceColor, refNames: ['refs/remotes/alice/feature'] },
      { id: 'historical', label: 'Historical branch', family: 'historical', kind: 'local', lane: 3, color: historicalColor, refNames: [] },
    ];
    return { nodes, edges, tracks };
  }

  it('never turns a shared live ancestor into gray', () => {
    const context = fixture();
    const resolver = createGraphColorResolver(context);
    const shared = context.nodes.find((candidate) => candidate.id === 'shared')!;
    const color = resolver.colorForNode(shared);

    expect(color).not.toBe('var(--graph-muted)');
    expect(hueOf(color)).toBe(hueOf(featureColor));
  });

  it('never turns a shared live edge into gray', () => {
    const context = fixture();
    const resolver = createGraphColorResolver(context);

    for (const edge of context.edges.filter((candidate) => candidate.id !== 'previous-shared')) {
      const color = resolver.colorForEdge(edge);
      expect(color).not.toBe('var(--graph-muted)');
      expect(hueOf(color)).toBe(hueOf(featureColor));
    }
  });

  it('keeps historical nodes and edges gray', () => {
    const context = fixture();
    const resolver = createGraphColorResolver(context);
    const previous = context.nodes.find((candidate) => candidate.id === 'previous')!;
    const historicalEdge = context.edges.find((candidate) => candidate.id === 'previous-shared')!;

    expect(resolver.colorForNode(previous)).toBe(historicalColor);
    expect(resolver.colorForEdge(historicalEdge)).toBe(historicalColor);
  });

  it('uses the family color for a shared section even when its track is missing', () => {
    const context = fixture();
    const resolver = createGraphColorResolver(context);
    const shared = context.nodes.find((candidate) => candidate.id === 'shared')!;
    const sharedColor = resolver.colorForNode(shared);

    expect(hueOf(sharedColor)).toBe(hueOf(featureColor));
    expect(hueOf(sharedColor)).toBe(hueOf(aliceColor));
  });
});
