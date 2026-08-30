import type { WorkingTreeState } from '../../../src/git/gitTypes';
import { summarizeWorkingTree } from './workingTreePresentation';

export function WorkingTreeSummaryPanel({ tree }: { tree: WorkingTreeState }) {
  const summary = summarizeWorkingTree(tree);
  const title = tree.mainWorktree === false ? 'Worktree' : 'Working Tree';

  return <div className="working-summary-overlay" role="status" aria-label={`${title} summary`}>
    {summary.inaccessible ? <span className="working-summary-status">Status unavailable</span> : summary.clean ? <span className="working-summary-status clean">Clean</span> : <div className="working-summary-stats" aria-label={`${summary.files} files, ${summary.additions} additions, ${summary.deletions} deletions`}>
      <span className="working-summary-stat files"><strong>{summary.files}</strong><span>files</span></span>
      <span className="working-summary-stat additions"><strong>+{summary.additions}</strong></span>
      <span className="working-summary-stat deletions"><strong>−{summary.deletions}</strong></span>
    </div>}
  </div>;
}
