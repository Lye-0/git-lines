import type { GraphFactModel, GraphLayout } from '../model/graphModel.js';
import { allOverlayRelations } from '../model/graphModel.js';
import { computeLaneLayout } from './laneLayout.js';
import { computeRowLayout } from './rowLayout.js';
import { placeBranchRenameEventsOnWorkingTreeCurves, placeRebaseEventsOnParentCurves, routeCherryPickGroups, routeEdges, routeHistoryRelations, routeRebaseRelations, routeRefMovements, routeRewriteCollapseRelations } from './edgeRouter.js';
import { insertOperationAnnotationRows } from './operationRows.js';
import { defaultFixedLayout } from './defaultFixedLayout.js';
import { fastForwardLayout } from './fastForwardLayout.js';
import { placeFastForwardEventsOnCurves } from './edgeRouter.js';
import type { DefaultBranchTarget } from '../model/defaultBranchResolver.js';
import type { GitCommit, ReflogEntry } from '../git/gitTypes.js';
import { branchLineage, sourcePrimaryBranch } from '../model/branchLineage.js';
import { integrationEventIds, routeBranchIntegrations } from './branchIntegrationLayout.js';

export interface GraphLayoutOptions {
  routeEvidenceCommits?: GitCommit[];
  visibleCommitCount: number;
  hasMore: boolean;
  primaryBranch?: string;
  previousRows?: Map<string, number>;
  previousLanes?: Map<string, number>;
  previousNodeLanes?: Map<string, number>;
  rowHeight?: number;
  laneWidth?: number;
  fixedDefault?: DefaultBranchTarget;
  protectionReflogs?: ReflogEntry[];
}

export function createGraphLayout(facts: GraphFactModel, options: GraphLayoutOptions): GraphLayout {
  const rows = computeRowLayout(facts.nodes, facts.edges, options.previousRows);
  const lineage = branchLineage(options.protectionReflogs ?? []);
  const legacyLanes = computeLaneLayout({ ...facts, nodes: rows.nodes }, {
    previousLanes: options.previousLanes,
    previousNodeLanes: options.previousNodeLanes,
    primaryBranch: sourcePrimaryBranch(facts.refs, facts.primaryBranch, lineage, options.primaryBranch),
    lineage,
    protectionReflogs: options.protectionReflogs,
    routeEvidenceCommits: options.routeEvidenceCommits,
  });
  const protectedLanes = fastForwardLayout(legacyLanes, facts, options.protectionReflogs ?? []);
  const lanes = options.fixedDefault
    ? defaultFixedLayout(protectedLanes, facts, options.fixedDefault, options.protectionReflogs ?? []) : protectedLanes;
  const laidOutNodes = lanes.nodes.map((node) => ({ ...node, row: rows.rows.get(node.id) ?? node.row }));
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const historyRelations = facts.historyRelations ?? [];
  const refMovementRelations = facts.refMovementRelations ?? [];
  const rebaseRelations = facts.rebaseRelations ?? [];
  const cherryPickGroupRelations = facts.cherryPickGroupRelations ?? [];
  const rewriteCollapseRelations = facts.rewriteCollapseRelations ?? [];
  const operationRows = insertOperationAnnotationRows(laidOutNodes, allOverlayRelations({ historyRelations, refMovementRelations, rebaseRelations, cherryPickGroupRelations, rewriteCollapseRelations }));
  const annotationRows = new Map(operationRows.rows.map((row) => [row.relationId, row.row]));
  const integrations = facts.branchIntegrations ?? [];
  const junctions = integrationEventIds(operationRows.nodes, integrations);
  const annotationEdges = facts.edges.filter(edge => !(edge.annotation === 'ref-event' && junctions.has(edge.toNodeId)));
  const routedNodes = placeRebaseEventsOnParentCurves(
    placeFastForwardEventsOnCurves(placeBranchRenameEventsOnWorkingTreeCurves(operationRows.nodes, facts.edges, { rowHeight, laneWidth }), annotationEdges, { rowHeight, laneWidth }),
    facts.edges,
    { rowHeight, laneWidth },
  );
  const rebaseOverlay = routeRebaseRelations(routedNodes, rebaseRelations, { rowHeight, laneWidth, annotationRows });
  const cherryPickOverlay = routeCherryPickGroups(routedNodes, cherryPickGroupRelations, { rowHeight, laneWidth, annotationRows });
  const collapseOverlay = routeRewriteCollapseRelations(routedNodes, rewriteCollapseRelations, { rowHeight, laneWidth, annotationRows });
  const branchFlow = routeBranchIntegrations(routedNodes, facts.edges, integrations,
    routeEdges(routedNodes, annotationEdges, { rowHeight, laneWidth }), { rowHeight, laneWidth }, lanes.tracks);
  return {
    nodes: routedNodes,
    edges: facts.edges,
    tracks: lanes.tracks,
    visibleCommitCount: options.visibleCommitCount,
    hasMore: options.hasMore,
    rowHeight,
    laneWidth,
    edgePaths: branchFlow.edgePaths,
    branchIntegrations: integrations,
    branchIntegrationPaths: branchFlow.paths,
    historyRelations,
    historyRelationPaths: routeHistoryRelations(routedNodes, historyRelations, { rowHeight, laneWidth, annotationRows }),
    refMovementRelations,
    refMovementPaths: routeRefMovements(routedNodes, refMovementRelations, { rowHeight, laneWidth, annotationRows }),
    rebaseRelations,
    rebaseRelationPaths: rebaseOverlay.paths,
    rebaseGroupOutlines: rebaseOverlay.outlines,
    cherryPickGroupRelations,
    cherryPickGroupPaths: cherryPickOverlay.paths,
    cherryPickGroupOutlines: cherryPickOverlay.outlines,
    rewriteCollapseRelations,
    rewriteCollapsePaths: collapseOverlay.paths,
    rewriteCollapseOutlines: collapseOverlay.outlines,
    operationAnnotationRows: operationRows.rows,
  };
}
