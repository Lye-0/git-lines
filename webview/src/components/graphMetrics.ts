import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { allOverlayRelations } from '../../../src/model/graphModel';
import { estimatedRefBadgeWidth, estimatedRefMovementBadgeWidth, pointForNode, REF_MOVEMENT_MAX_BULGE, refMovementBadgeOffset } from '../../../src/layout/edgeRouter';
import { operationAnnotationLabel, operationKindLabel } from './operationPresentation';
import { layoutGraphSideRefEndpoints, messageSideGhostRefBadges, messageSideRefBadges, graphSideRefFullNamesForNode } from './refMovementPresentation';

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

const BADGE_GAP = 5;
const ROW_HEADING_GAP = 9;
const ROW_CONTENT_INSET = 24;
const GRAPH_SIDE_BADGE_TRAILING_PAD = 12;
const OPERATION_LABEL_CHARACTER_WIDTH = 7.2;
const OPERATION_LABEL_LEADING_OFFSET = 10;
const OPERATION_LABEL_TRAILING_GAP = 14;
const OPERATION_DIAMOND_RADIUS = 6;

function estimatedBadgeWidth(badge: NonNullable<GraphLayout['nodes'][number]['refBadges']>[number]): number {
  return estimatedRefBadgeWidth(badge.name, badge.kind, Boolean(badge.isDefault));
}

function estimatedGraphSideBadgeWidth(badge: NonNullable<GraphLayout['nodes'][number]['refBadges']>[number]): number {
  return estimatedRefMovementBadgeWidth(badge.name, badge.kind, Boolean(badge.isDefault));
}

/**
 * Returns the minimum row-content width needed to keep every visible ref
 * badge at its normal width. The browser still owns the final font metrics;
 * this estimate only reserves scrollable space before the fixed changes
 * column, so flexbox never has to shrink a badge to fit the viewport.
 */
export function changesColumnStartForLayout(layout: Pick<GraphLayout, 'nodes' | 'historyRelations' | 'refMovementRelations' | 'rebaseRelations'>): number {
  let required = COMMIT_CONTENT_MIN_WIDTH;
  const relations = layout.refMovementRelations ?? [];
  for (const node of layout.nodes) {
    const moved = graphSideRefFullNamesForNode(node, relations);
    const badges = [...messageSideRefBadges(node, moved), ...messageSideGhostRefBadges(node, moved)];
    if (!badges.length) continue;
    const badgeWidth = badges.reduce((total, badge) => total + estimatedBadgeWidth(badge), 0) + Math.max(0, badges.length - 1) * BADGE_GAP;
    const titleWidth = Math.min(620, (node.subject ?? node.label ?? '').length * OPERATION_LABEL_CHARACTER_WIDTH);
    required = Math.max(required, Math.ceil(titleWidth + ROW_HEADING_GAP + badgeWidth + ROW_CONTENT_INSET));
  }
  for (const relation of allOverlayRelations(layout)) {
    const operationWidth = Math.min(620, operationAnnotationLabel(relation).length * OPERATION_LABEL_CHARACTER_WIDTH);
    required = Math.max(required, Math.ceil(operationWidth + ROW_CONTENT_INSET));
  }
  return required;
}

export function timelineContentWidthForLayout(layout: Pick<GraphLayout, 'nodes' | 'historyRelations' | 'refMovementRelations' | 'rebaseRelations'>): number {
  return Math.max(TIMELINE_MIN_CONTENT_WIDTH, changesColumnStartForLayout(layout) + CHANGES_COLUMN_WIDTH + 11);
}

export function graphWidthForLayout(layout: Pick<GraphLayout, 'nodes' | 'laneWidth'> & Partial<Pick<GraphLayout, 'rowHeight' | 'historyRelations' | 'refMovementRelations' | 'rebaseRelations' | 'historyRelationPaths' | 'refMovementPaths' | 'rebaseRelationPaths'>>): number {
  const maxLane = Math.max(0, ...layout.nodes.map((node) => node.lane ?? 0));
  const laneWidth = Math.max(136, (maxLane + 1) * layout.laneWidth + 48);
  let required = laneWidth;
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  let badgeExtent = 0;
  const grouped = new Map<string, ReturnType<typeof layoutGraphSideRefEndpoints>>();
  for (const endpoint of layoutGraphSideRefEndpoints({
    nodes: layout.nodes,
    refMovementRelations: layout.refMovementRelations ?? [],
  })) {
    const list = grouped.get(endpoint.nodeId) ?? [];
    list.push(endpoint);
    grouped.set(endpoint.nodeId, list);
  }
  for (const [nodeId, endpoints] of grouped) {
    const node = byId.get(nodeId);
    if (!node) continue;
    const point = pointForNode(node, { laneWidth: layout.laneWidth, rowHeight: layout.rowHeight });
    let left = point.x + refMovementBadgeOffset();
    for (const endpoint of endpoints) {
      left += estimatedGraphSideBadgeWidth(endpoint.badge) + BADGE_GAP;
    }
    badgeExtent = Math.max(badgeExtent, left - BADGE_GAP + GRAPH_SIDE_BADGE_TRAILING_PAD);
  }
  required = Math.max(required, badgeExtent);

  const relations = allOverlayRelations(layout);
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  const paths = [...(layout.historyRelationPaths ?? []), ...(layout.refMovementPaths ?? []), ...(layout.rebaseRelationPaths ?? [])];
  for (const path of paths) {
    const relation = relationById.get(path.relationId);
    if (!relation) continue;
    const labelWidth = Math.min(620, operationKindLabel(relation.kind).length * OPERATION_LABEL_CHARACTER_WIDTH);
    required = Math.max(
      required,
      Math.ceil(path.labelX + OPERATION_LABEL_LEADING_OFFSET + OPERATION_DIAMOND_RADIUS + labelWidth + OPERATION_LABEL_TRAILING_GAP),
    );
  }

  // Unit callers and partially assembled layouts may not have routed paths
  // yet. Reserve a conservative operation-label region in that case; the
  // fully laid-out path above remains the source of truth in the webview.
  if (paths.length === 0 && relations.length > 0) {
    const fallbackLabelX = laneWidth + REF_MOVEMENT_MAX_BULGE;
    for (const relation of relations) {
      const labelWidth = Math.min(620, operationKindLabel(relation.kind).length * OPERATION_LABEL_CHARACTER_WIDTH);
      required = Math.max(
        required,
        Math.ceil(fallbackLabelX + OPERATION_LABEL_LEADING_OFFSET + OPERATION_DIAMOND_RADIUS + labelWidth + OPERATION_LABEL_TRAILING_GAP),
      );
    }
  }
  return required;
}
