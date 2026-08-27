import type { GraphFactModel, GraphLayout } from '../model/graphModel.js';
import { computeLaneLayout } from './laneLayout.js';
import { computeRowLayout } from './rowLayout.js';

export interface GraphLayoutOptions {
  visibleCommitCount: number;
  hasMore: boolean;
  primaryBranch?: string;
  previousRows?: Map<string, number>;
  previousLanes?: Map<string, number>;
  rowHeight?: number;
  laneWidth?: number;
}

export function createGraphLayout(facts: GraphFactModel, options: GraphLayoutOptions): GraphLayout {
  const rows = computeRowLayout(facts.nodes, facts.edges, options.previousRows);
  const lanes = computeLaneLayout({ ...facts, nodes: rows.nodes }, {
    previousLanes: options.previousLanes,
    primaryBranch: options.primaryBranch,
  });
  return {
    nodes: lanes.nodes.map((node) => ({ ...node, row: rows.rows.get(node.id) ?? node.row })),
    edges: facts.edges,
    tracks: lanes.tracks,
    visibleCommitCount: options.visibleCommitCount,
    hasMore: options.hasMore,
    rowHeight: options.rowHeight ?? 38,
    laneWidth: options.laneWidth ?? 28,
  };
}
