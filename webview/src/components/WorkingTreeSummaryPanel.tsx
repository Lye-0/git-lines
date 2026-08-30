import type { WorkingTreeState } from '../../../src/git/gitTypes';
import { ChangeStatsGrid } from './ChangeStatsGrid';
import { summarizeWorkingTree } from './workingTreePresentation';

export function WorkingTreeSummaryPanel({ tree }: { tree: WorkingTreeState }) {
  const summary = summarizeWorkingTree(tree);
  const title = tree.mainWorktree === false ? 'Worktree' : 'Working Tree';

  return <div className="working-summary-overlay" role="status" aria-label={`${title} summary`}>
    {summary.inaccessible ? <span className="working-summary-status">Status unavailable</span> : summary.clean ? <span className="working-summary-status clean">Clean</span> : <ChangeStatsGrid stats={summary} className="working-summary-stats" ariaLabel={`${summary.files} files, ${summary.additions} additions, ${summary.deletions} deletions`} />}
  </div>;
}
