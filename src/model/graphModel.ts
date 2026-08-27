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
  event?: HistoryEvent;
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
}

export interface GraphTrack {
  id: string;
  label: string;
  family: string;
  kind: 'local' | 'remote';
  lane: number;
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
