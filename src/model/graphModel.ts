import type { GraphLayout as RenderGraphLayout } from '../layout/layoutTypes.js';
import type { GitCommit, GitRef, HistoryEvent, OperationState, WorkingTreeState } from '../git/gitTypes.js';
import type { GraphRefBadge } from './refDisplay.js';

export type GraphNodeKind =
  | 'commit'
  | 'reflog-commit'
  | 'working-tree'
  | 'operation'
  | 'fast-forward-event'
  | 'history-event'
  | 'history-boundary';

export type GraphSyncState = 'shared' | 'local-only' | 'remote-only';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  row?: number;
  lane?: number;
  oid?: string;
  label?: string;
  refIds: string[];
  trackId?: string;
  timestamp?: number;
  subject?: string;
  commit?: GitCommit;
  /** Synchronization reachability for real commit nodes. */
  syncState?: GraphSyncState;
  /** Commit belongs to the old route produced by a reset or amend event. */
  previousRoute?: boolean;
  /** A ref-move event whose destination is currently on a historical route. */
  historicalEvent?: boolean;
  event?: HistoryEvent;
  /** Commit node reached by a ref event. Ref events do not participate in the commit DAG. */
  anchorCommitId?: string;
  /** Commit immediately below the semantic boundary where the event is shown. */
  eventBoundaryCommitId?: string;
  /** Commit immediately above the semantic boundary used for the annotation edge. */
  eventStartCommitId?: string;
  /** The ref name whose lane owns a ref event (for example refs/heads/main). */
  targetRef?: string;
  /** Graph-track identifier resolved from targetRef during lane layout. */
  targetLaneId?: string;
  workingTree?: WorkingTreeState;
  operation?: OperationState;
  refBadges?: GraphRefBadge[];
}

export type GraphEdgeType = 'parent' | 'operation' | 'working-tree' | 'history-event';

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  fromNodeId: string;
  toNodeId: string;
  trackId?: string;
  label?: string;
  /** A visual-only connector that annotates a fact without changing the DAG. */
  annotation?: 'ref-event' | 'shallow-boundary';
}

export interface GraphTrack {
  id: string;
  label: string;
  family: string;
  kind: 'local' | 'remote';
  lane: number;
  /** Visible Y intervals occupied by this branch identity and their lanes. */
  segments?: Array<{ startRow: number; endRow: number; lane: number }>;
  color: string;
  refNames: string[];
}

export interface GraphFactModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refs: GitRef[];
  commits: GitCommit[];
  workingTrees: WorkingTreeState[];
  operations: OperationState[];
  events: HistoryEvent[];
  primaryBranch?: string;
  shallowBoundaryOids: string[];
}

export type GraphLayout = RenderGraphLayout;
