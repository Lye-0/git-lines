import type { GraphLayout } from '../../../src/layout/layoutTypes';

/** Shared horizontal placement for the normal-row change statistics column. */
export const CHANGES_COLUMN_START = 1180;
export const CHANGES_COLUMN_WIDTH = 222;
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
