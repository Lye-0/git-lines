import type { GraphLayout } from '../../../src/layout/layoutTypes';

/** Shared horizontal placement for the normal-row change statistics column. */
export const CHANGES_COLUMN_START = 1180;
export const CHANGES_COLUMN_WIDTH = 222;
/**
 * Baseline width for the complete timeline. Below this width the scroll
 * viewport moves over the timeline instead of collapsing its content rows.
 */
export const TIMELINE_MIN_WIDTH = 1150;
/**
 * Keep a readable commit-content area before the fixed changes grid.  The
 * resulting minimum canvas width is intentionally larger than a narrow
 * viewport so the graph can use horizontal scrolling instead of collapsing
 * rows or dropping data.
 */
export const COMMIT_CONTENT_MIN_WIDTH = 320;
// 14px row gap + 22px row border/padding + 7px changes-column alignment inset.
export const TIMELINE_MIN_CONTENT_WIDTH = COMMIT_CONTENT_MIN_WIDTH + CHANGES_COLUMN_WIDTH + 43;
/**
 * Normal row content has a 1px border and 10px of right padding. Include that
 * inset in the bounded content width so the fixed stats grid starts at the
 * same x position as the overlay grid used by Working Tree.
 */
export const CHANGES_COLUMN_CONTENT_WIDTH = CHANGES_COLUMN_START + CHANGES_COLUMN_WIDTH + 11;

export function graphWidthForLayout(layout: Pick<GraphLayout, 'nodes' | 'laneWidth'>): number {
  const maxLane = Math.max(0, ...layout.nodes.map((node) => node.lane ?? 0));
  return Math.max(136, (maxLane + 1) * layout.laneWidth + 48);
}
