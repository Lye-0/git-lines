import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { operationAnnotationLabel } from './operationPresentation';

/** Shared horizontal placement for the normal-row change statistics column. */
export const CHANGES_COLUMN_START = 1180;
export const CHANGES_COLUMN_WIDTH = 222;
/**
 * Baseline width for the complete timeline. Below this width the scroll
 * viewport moves over the timeline instead of collapsing its content rows.
 */
export const TIMELINE_MIN_WIDTH = 1050;
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

const REF_BADGE_MAX_WIDTH = 240;
const REF_BADGE_HORIZONTAL_PADDING = 12;
const REF_BADGE_CHARACTER_WIDTH = 7.2;
const BADGE_GAP = 5;
const ROW_HEADING_GAP = 9;
const ROW_CONTENT_INSET = 24;

function estimatedBadgeWidth(badge: NonNullable<GraphLayout['nodes'][number]['refBadges']>[number]): number {
  const tagMarkerWidth = badge.kind === 'tag' ? 14 : 0;
  const defaultSuffixWidth = badge.isDefault ? 70 : 0;
  return Math.min(REF_BADGE_MAX_WIDTH, Math.ceil((badge.name.length * REF_BADGE_CHARACTER_WIDTH) + tagMarkerWidth + defaultSuffixWidth + REF_BADGE_HORIZONTAL_PADDING));
}

/**
 * Returns the minimum row-content width needed to keep every visible ref
 * badge at its normal width. The browser still owns the final font metrics;
 * this estimate only reserves scrollable space before the fixed changes
 * column, so flexbox never has to shrink a badge to fit the viewport.
 */
export function changesColumnStartForLayout(layout: Pick<GraphLayout, 'nodes' | 'historyRelations'>): number {
  let required = COMMIT_CONTENT_MIN_WIDTH;
  for (const node of layout.nodes) {
    const badges = node.refBadges ?? [];
    if (!badges.length) continue;
    const badgeWidth = badges.reduce((total, badge) => total + estimatedBadgeWidth(badge), 0) + Math.max(0, badges.length - 1) * BADGE_GAP;
    const titleWidth = Math.min(620, (node.subject ?? node.label ?? '').length * REF_BADGE_CHARACTER_WIDTH);
    required = Math.max(required, Math.ceil(titleWidth + ROW_HEADING_GAP + badgeWidth + ROW_CONTENT_INSET));
  }
  for (const relation of layout.historyRelations ?? []) {
    const operationWidth = Math.min(620, operationAnnotationLabel(relation).length * REF_BADGE_CHARACTER_WIDTH);
    required = Math.max(required, Math.ceil(operationWidth + ROW_CONTENT_INSET));
  }
  return required;
}

export function timelineContentWidthForLayout(layout: Pick<GraphLayout, 'nodes' | 'historyRelations'>): number {
  return Math.max(TIMELINE_MIN_CONTENT_WIDTH, changesColumnStartForLayout(layout) + CHANGES_COLUMN_WIDTH + 11);
}

export function graphWidthForLayout(layout: Pick<GraphLayout, 'nodes' | 'laneWidth'>): number {
  const maxLane = Math.max(0, ...layout.nodes.map((node) => node.lane ?? 0));
  return Math.max(136, (maxLane + 1) * layout.laneWidth + 48);
}
