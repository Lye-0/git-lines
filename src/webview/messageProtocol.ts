import type { GitCommit, RepositoryInfo, WorkingTreeState } from '../git/gitTypes.js';
import type { GraphLayout } from '../layout/layoutTypes.js';

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'loadMore' }
  | { type: 'select'; oid: string }
  | { type: 'toggleReflog'; enabled: boolean }
  | { type: 'setDensity'; density: 'comfortable' | 'compact' };

export type ExtensionToWebviewMessage =
  | {
      type: 'graph';
      layout: GraphLayout;
      repository: RepositoryInfo;
      currentBranch?: string;
      workingTrees: WorkingTreeState[];
      reflogEnabled: boolean;
      density: 'comfortable' | 'compact';
    }
  | { type: 'loading'; loading: boolean }
  | { type: 'error'; title: string; detail?: string }
  | { type: 'detail'; detail: (GitCommit & { files: string[]; additions?: number; deletions?: number }) | null };
