import type { GraphEdge, GraphNode, GraphTrack, HistoryRelation, RebaseRelation, RefMovementRelation } from '../model/graphModel.js';

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tracks: GraphTrack[];
  visibleCommitCount: number;
  hasMore: boolean;
  rowHeight: number;
  laneWidth: number;
  edgePaths?: EdgePath[];
  /** Presentation-only operation paths; they never affect row or lane layout. */
  historyRelations?: HistoryRelation[];
  historyRelationPaths?: HistoryRelationPath[];
  refMovementRelations?: RefMovementRelation[];
  refMovementPaths?: RefMovementPath[];
  rebaseRelations?: RebaseRelation[];
  rebaseRelationPaths?: HistoryRelationPath[];
  rebaseGroupOutlines?: RebaseGroupOutline[];
  /** Visual-only rows for operation annotations; never DAG nodes or lane claims. */
  operationAnnotationRows?: OperationAnnotationRow[];
}

export interface OperationAnnotationRow {
  id: string;
  relationId: string;
  row: number;
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

export interface HistoryRelationPath {
  id: string;
  relationId: string;
  kind: HistoryRelation['kind'] | RebaseRelation['kind'];
  sourceNodeId: string;
  targetNodeId: string;
  d: string;
  /** Triangle at NEW for amend / cherry-pick. Empty for revert. */
  arrowD: string;
  /** Cancel mark at TARGET for revert. Absent for amend / cherry-pick. */
  sourceMarkerD?: string;
  labelX: number;
  labelY: number;
}

export interface RebaseGroupOutline {
  id: string;
  relationId: string;
  role: 'old' | 'new';
  d: string;
}

export interface RefMovementPath {
  id: string;
  relationId: string;
  kind: RefMovementRelation['kind'];
  sourceNodeId: string;
  targetNodeId: string;
  d: string;
  arrowD: string;
  labelX: number;
  labelY: number;
}
