export interface GitCommit {
  oid: string;
  parentOids: string[];
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  authorDate: number;
  committerName: string;
  committerEmail?: string;
  committerDate: number;
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
  clean: boolean;
  inaccessible?: boolean;
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
  timestamp: number;
  sourceLabel?: string;
  subject?: string;
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
