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

/** How the current checkout reaches a commit shown in the graph. */
export type GraphHeadState = 'attached' | 'detached';

/** Why a commit is retained outside the current live ref graph. */
export type HistoricalRouteKind = 'previous' | 'deleted-branch' | 'unreferenced';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  row?: number;
  lane?: number;
  /** Optional SVG X override for an annotation inserted on an existing edge. */
  visualX?: number;
  oid?: string;
  label?: string;
  refIds: string[];
  trackId?: string;
  timestamp?: number;
  subject?: string;
  commit?: GitCommit;
  /** Synchronization reachability for real commit nodes. */
  syncState?: GraphSyncState;
  /** Set only on the commit currently pointed to by the opened worktree's HEAD. */
  headState?: GraphHeadState;
  /** Commit belongs to the old route produced by a reset or amend event. */
  previousRoute?: boolean;
  /** Explicit reason for a non-live route, when Git metadata supports it. */
  historicalKind?: HistoricalRouteKind;
  /** Stable identity shared by commits in one historical side route. */
  historicalRouteId?: string;
  /** Only the tip/head of a historical side route receives its route badge. */
  historicalRouteHead?: boolean;
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
  /** A ref-only operation shown in the post-Working-Tree operation timeline. */
  refOnly?: boolean;
  workingTree?: WorkingTreeState;
  /** Worktrees checked out elsewhere and attached to this commit row. */
  linkedWorktrees?: WorkingTreeState[];
  operation?: OperationState;
  refBadges?: GraphRefBadge[];
  /** Historical ref positions for Ref Movement overlays. Never current live refs. */
  ghostRefBadges?: GraphRefBadge[];
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

/**
 * A Git-proven history transformation that is intentionally kept outside the
 * commit DAG and its timeline rows.  Overlay arrows are emitted only when both
 * endpoints are explicit Git evidence currently loaded in the graph.
 */
export interface HistoryRelation {
  id: string;
  kind: 'amend' | 'cherry-pick' | 'revert';
  sourceOid: string;
  targetOid: string;
  refName?: string;
  timestamp: number;
  rawReflogMessage?: string;
  evidence: 'reflog';
}

/**
 * A proven Git ref movement.  Endpoints are historical/current ref positions,
 * not a commit rewrite from source commit to target commit.
 */
export interface RefMovementRelation {
  id: string;
  kind: 'reset' | 'branch-move';
  refName: string;
  fromOid: string;
  toOid: string;
  timestamp: number;
  rawReflogMessage?: string;
  evidence: 'reflog';
  resetMode?: 'soft' | 'mixed' | 'hard';
  removedCommitCount?: number;
  removedRangeStartOid?: string;
  removedRangeEndOid?: string;
}

/**
 * A proven completed rebase that rewrote a linear commit range onto a new
 * base.  Membership is group-to-group; oldOids[i] is not a mapped partner of
 * newOids[i].
 */
export interface RebaseRelation {
  id: string;
  kind: 'rebase';
  refName: string;
  /** Oldest → newest commits replayed from the old tip, excluding the shared base. */
  oldOids: string[];
  /** Oldest → newest commits created on the new base, excluding onto. */
  newOids: string[];
  oldTipOid: string;
  newTipOid: string;
  ontoOid?: string;
  timestamp: number;
  rawReflogMessage?: string;
  evidence: 'reflog';
}

/**
 * A proven contiguous interactive squash or fixup: the entire old linear
 * range collapsed into one new commit.  There are no individual old→new
 * mappings and no fixup-target arrows.  `id` is a rewrite-collapse: selection
 * key and must not reuse the generic rebase History Event id.
 */
export interface RewriteCollapseRelation {
  id: string;
  kind: 'squash' | 'fixup';
  refName: string;
  /** Oldest → newest commits in the rewritten old range, excluding onto. */
  oldOids: string[];
  newOid: string;
  oldTipOid: string;
  newTipOid: string;
  ontoOid?: string;
  timestamp: number;
  rawReflogMessage?: string;
  evidence: 'reflog';
}

/**
 * Graph grouping of contiguous Exact `-x` cherry-pick relations.  This is
 * visual grouping of proven SOURCE → TARGET pairs, not a proof that Git ran
 * one cherry-pick command.  Non-contiguous sources stay as individual Exact
 * HistoryRelations.
 */
export interface CherryPickGroupRelation {
  id: string;
  kind: 'cherry-pick-group';
  mappings: Array<{ sourceOid: string; targetOid: string }>;
  /** Oldest → newest SOURCE commits, aligned with mappings. */
  sourceOids: string[];
  /** Oldest → newest TARGET commits, aligned with mappings. */
  targetOids: string[];
  sourceTipOid: string;
  targetTipOid: string;
  targetRefName?: string;
  refName?: string;
  timestamp: number;
  rawReflogMessage?: string;
  evidence: 'commit-body';
}

export type OverlayRelation = HistoryRelation | RefMovementRelation | RebaseRelation | CherryPickGroupRelation | RewriteCollapseRelation;

export function isRefMovementRelation(relation: OverlayRelation): relation is RefMovementRelation {
  return relation.kind === 'reset' || relation.kind === 'branch-move';
}

export function isRebaseRelation(relation: OverlayRelation): relation is RebaseRelation {
  return relation.kind === 'rebase';
}

export function isCherryPickGroupRelation(relation: OverlayRelation): relation is CherryPickGroupRelation {
  return relation.kind === 'cherry-pick-group';
}

export function isRewriteCollapseRelation(relation: OverlayRelation): relation is RewriteCollapseRelation {
  return relation.kind === 'squash' || relation.kind === 'fixup';
}

export function allOverlayRelations(model: {
  historyRelations?: HistoryRelation[];
  refMovementRelations?: RefMovementRelation[];
  rebaseRelations?: RebaseRelation[];
  cherryPickGroupRelations?: CherryPickGroupRelation[];
  rewriteCollapseRelations?: RewriteCollapseRelation[];
}): OverlayRelation[] {
  return [
    ...(model.historyRelations ?? []),
    ...(model.refMovementRelations ?? []),
    ...(model.rebaseRelations ?? []),
    ...(model.cherryPickGroupRelations ?? []),
    ...(model.rewriteCollapseRelations ?? []),
  ];
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
  /** Historical side-route classification, when this is not a live track. */
  historicalKind?: HistoricalRouteKind;
  /** Internal live route created for a detached HEAD; it has no branch name. */
  detached?: boolean;
}

export interface GraphFactModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  refs: GitRef[];
  commits: GitCommit[];
  workingTrees: WorkingTreeState[];
  operations: OperationState[];
  events: HistoryEvent[];
  /** Commit-operation overlays do not participate in rows, lanes, or DAG edges. */
  historyRelations?: HistoryRelation[];
  /** Ref-position overlays; distinct from commit HistoryRelation. */
  refMovementRelations?: RefMovementRelation[];
  /** Grouped commit-rewrite overlays for completed linear rebases. */
  rebaseRelations?: RebaseRelation[];
  /** Grouped exact cherry-pick overlays; individuals remain in historyRelations. */
  cherryPickGroupRelations?: CherryPickGroupRelation[];
  /** Contiguous squash/fixup collapse; non-contiguous autosquash stays on History Event fallback. */
  rewriteCollapseRelations?: RewriteCollapseRelation[];
  primaryBranch?: string;
  shallowBoundaryOids: string[];
}

export type GraphLayout = RenderGraphLayout;
