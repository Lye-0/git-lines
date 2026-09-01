import type { GraphEdge, GraphNode, GraphTrack } from '../model/graphModel.js';

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tracks: GraphTrack[];
  visibleCommitCount: number;
  hasMore: boolean;
  rowHeight: number;
  laneWidth: number;
  edgePaths?: EdgePath[];
}

export interface EdgePath {
  id: string;
  type: GraphEdge['type'];
  d: string;
  label?: string;
  annotation?: GraphEdge['annotation'];
  /**
   * Fact edge represented by this path. A completed Rebase parent edge can
   * be rendered as two paths through its History Event while the fact edge
   * remains a single Git parent relationship.
   */
  edgeId?: string;
  /** Visual endpoints for a segmented path; these may include an event node. */
  fromNodeId?: string;
  toNodeId?: string;
}
