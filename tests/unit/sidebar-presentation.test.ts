import { describe, expect, it } from 'vitest';
import { sidebarPopoverPosition, sidebarRowOffsets } from '../../webview/src/components/sidebarPresentation';
import type { GraphLayout } from '../../src/layout/layoutTypes';
import { graphWidthForLayout } from '../../webview/src/components/graphMetrics';

describe('sidebar presentation', () => {
  it('aligns Working Tree with the commit below it instead of the widest graph lane', () => {
    const layout: GraphLayout = {
      nodes: [
        { id: 'wt', kind: 'working-tree', row: 0, lane: 0, refIds: [] },
        { id: 'head', kind: 'commit', row: 1, lane: 0, refIds: [] },
        { id: 'side', kind: 'commit', row: 2, lane: 2, refIds: [] },
      ],
      edges: [{ id: 'wt:head', type: 'working-tree', fromNodeId: 'wt', toNodeId: 'head' }],
      edgePaths: [{ id: 'wt:head', type: 'working-tree', d: 'M 24 18 C 24 26, 24 38, 24 46' }],
      tracks: [], laneWidth: 22, rowHeight: 28, hasMore: false, visibleCommitCount: 2,
    };
    const offsets = sidebarRowOffsets(layout, 86);
    expect(offsets.get('wt')).toBe(38);
    expect(offsets.get('wt')).toBe(offsets.get('head'));
    expect(offsets.get('side')).toBe(82);
  });
  it('starts next to each row node while reserving space for a continuing side route', () => {
    const layout: GraphLayout = { nodes: [
      { id: 'a', kind: 'commit', row: 0, lane: 0, refIds: [] },
      { id: 'b', kind: 'commit', row: 1, lane: 1, refIds: [] },
      { id: 'c', kind: 'commit', row: 2, lane: 0, refIds: [] },
      { id: 'd', kind: 'commit', row: 3, lane: 1, refIds: [] },
    ], edges: [{ id: 'bd', type: 'parent', fromNodeId: 'b', toNodeId: 'd' }],
    edgePaths: [{ id: 'bd', type: 'parent', d: 'M 46 46 C 46 60, 46 88, 46 102' }],
    tracks: [], laneWidth: 22, rowHeight: 28, hasMore: false, visibleCommitCount: 4 };
    const before = JSON.stringify(layout);
    const offsets = sidebarRowOffsets(layout, 90);
    expect(offsets.get('a')).toBe(38);
    expect(offsets.get('b')).toBe(60);
    expect(offsets.get('c')).toBe(60);
    expect(JSON.stringify(layout)).toBe(before);
  });
  it('opens below near the top and above near the bottom within the viewport', () => {
    expect(sidebarPopoverPosition(60, 88, 650).upwards).toBe(false);
    expect(sidebarPopoverPosition(550, 578, 650).upwards).toBe(true);
    for (const height of [120, 300, 650]) {
      for (const top of [10, height / 2, height - 30]) {
        const result = sidebarPopoverPosition(top, top + 28, height);
        expect(result.top).toBeGreaterThanOrEqual(8);
        expect(result.top + result.maxHeight).toBeLessThanOrEqual(height - 8);
      }
    }
  });
  it('removes the normal minimum gutter only for sidebar graphs', () => {
    const layout = { nodes: [{ id: 'a', kind: 'commit' as const, refIds: [], lane: 0 }], laneWidth: 34 };
    expect(graphWidthForLayout(layout)).toBe(136);
    expect(graphWidthForLayout(layout, true)).toBe(42);
    expect(layout.nodes[0].lane).toBe(0);
  });
});
