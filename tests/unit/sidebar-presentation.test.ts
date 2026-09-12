import { describe, expect, it } from 'vitest';
import { sidebarPopoverPosition } from '../../webview/src/components/sidebarPresentation';
import { graphWidthForLayout } from '../../webview/src/components/graphMetrics';

describe('sidebar presentation', () => {
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
