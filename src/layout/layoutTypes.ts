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
}
