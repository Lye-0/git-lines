import type { GraphFactModel, GraphLayout } from '../model/graphModel.js';
import { computeLaneLayout } from './laneLayout.js';
import { computeRowLayout } from './rowLayout.js';
import { placeBranchRenameEventsOnWorkingTreeCurves, placeRebaseEventsOnParentCurves, routeEdges } from './edgeRouter.js';

export interface GraphLayoutOptions {
  visibleCommitCount: number;
  hasMore: boolean;
  primaryBranch?: string;
  previousRows?: Map<string, number>;
  previousLanes?: Map<string, number>;
  previousNodeLanes?: Map<string, number>;
  rowHeight?: number;
  laneWidth?: number;
}

export function createGraphLayout(facts: GraphFactModel, options: GraphLayoutOptions): GraphLayout {
  const rows = computeRowLayout(facts.nodes, facts.edges, options.previousRows);
  const lanes = computeLaneLayout({ ...facts, nodes: rows.nodes }, {
    previousLanes: options.previousLanes,
    previousNodeLanes: options.previousNodeLanes,
    primaryBranch: options.primaryBranch,
  });
  const laidOutNodes = lanes.nodes.map((node) => ({ ...node, row: rows.rows.get(node.id) ?? node.row }));
  const rowHeight = options.rowHeight ?? 38;
  const laneWidth = options.laneWidth ?? 34;
  const routedNodes = placeRebaseEventsOnParentCurves(
    placeBranchRenameEventsOnWorkingTreeCurves(laidOutNodes, facts.edges, { rowHeight, laneWidth }),
    facts.edges,
    { rowHeight, laneWidth },
  );
  return {
    nodes: routedNodes,
    edges: facts.edges,
    tracks: lanes.tracks,
    visibleCommitCount: options.visibleCommitCount,
    hasMore: options.hasMore,
    rowHeight,
    laneWidth,
    edgePaths: routeEdges(routedNodes, facts.edges, { rowHeight, laneWidth }),
  };
}
