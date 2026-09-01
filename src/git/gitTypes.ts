export interface GitCommit {
  oid: string;
  parentOids: string[];
  subject: string;
  body?: string;
  /** Number of paths changed by this commit when loaded from a log snapshot. */
  changedFiles?: number;
  /** Aggregate line additions/deletions from the snapshot's numstat batch. */
  additions?: number;
  deletions?: number;
  authorName: string;
  authorEmail?: string;
  authorDate: number;
  committerName: string;
  committerEmail?: string;
  committerDate: number;
}

export interface GitFileChange {
  path: string;
  /** Git name-status code (for example M, A, D, R or C). */
  status: string;
  additions?: number;
  deletions?: number;
}

export interface GitCommitDetail extends GitCommit {
  /** Kept as a flat list for protocol/backwards compatibility. */
  files: string[];
  fileChanges?: GitFileChange[];
}

export type GitRefType = 'local' | 'remote' | 'tag' | 'symbolic';

export interface GitRef {
  fullName: string;
  shortName: string;
  type: GitRefType;
  oid?: string;
  targetRef?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isDefault?: boolean;
}

export interface WorkingTreeState {
  worktreeId: string;
  path: string;
  headOid?: string;
  branch?: string;
  detached: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  /** Number of paths reported by porcelain status. */
  changedFiles?: number;
  /** Tracked additions/deletions in the current index/worktree diff. */
  additions?: number;
  deletions?: number;
  clean: boolean;
  inaccessible?: boolean;
  mainWorktree?: boolean;
  locked?: string;
  prunable?: string;
}

export type OperationType = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export interface OperationState {
  type: OperationType;
  headOid?: string;
  sourceOids: string[];
  detail?: string;
}

export interface ReflogEntry {
  refName: string;
  newOid: string;
  previousOid?: string;
  selector: string;
  timestamp: number;
  actorName?: string;
  actorEmail?: string;
  subject: string;
}

export type HistoryEventType =
  | 'fast-forward'
  | 'reset'
  | 'amend'
  | 'cherry-pick'
  | 'revert'
  | 'rebase'
  | 'force-update'
  | 'branch-move'
  | 'generic-ref-move';

export interface HistoryEvent {
  id: string;
  type: HistoryEventType;
  refName: string;
  fromOid?: string;
  toOid: string;
  /**
   * The commit immediately below the operation's semantic boundary. This is
   * separate from toOid: the latter is the ref destination, while this value
   * tells the timeline where the new history interval starts.
   */
  boundaryOid?: string;
  /** Commit immediately above the semantic boundary (the event connector source). */
  eventStartOid?: string;
  timestamp: number;
  /** Number of commits reachable from toOid but not from fromOid for FF events. */
  commitCount?: number;
  /** Source commit explicitly recorded by a completed cherry-pick, when available. */
  sourceOid?: string;
  /** Target commit explicitly recorded by a completed revert, when available. */
  targetOid?: string;
  /** Short, explicit operation name such as pull or merge. */
  operation?: string;
  /** Original reflog subject retained for tooltip/detail views. */
  rawReflogMessage?: string;
  sourceLabel?: string;
  subject?: string;
  /** All refs updated by the same logical Git operation, including HEAD. */
  affectedRefs?: string[];
}

export interface RepositoryInfo {
  root: string;
  gitDir: string;
  commonGitDir: string;
  bare: boolean;
  shallow: boolean;
  linkedWorktree: boolean;
}

export interface RepositorySnapshot {
  repository: RepositoryInfo;
  commits: GitCommit[];
  refs: GitRef[];
  workingTrees: WorkingTreeState[];
  operations: OperationState[];
  reflogs: ReflogEntry[];
  historyEvents: HistoryEvent[];
  shallowBoundaryOids: string[];
  hasMore: boolean;
  visibleCommitCount: number;
}
