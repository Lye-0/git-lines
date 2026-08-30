import type { WorkingTreeState } from '../../../src/git/gitTypes';
import { summarizeWorkingTree } from './workingTreePresentation';

export function WorkingTreeSummaryPanel({ tree }: { tree: WorkingTreeState }) {
  const summary = summarizeWorkingTree(tree);
  const title = tree.mainWorktree === false ? 'Worktree' : 'Working Tree';
  const location = tree.detached ? 'HEAD (detached)' : tree.branch ?? 'No branch';

  return <aside className="working-summary-panel" aria-label={`${title} summary`}>
    <div className="working-summary-heading">
      <span className="eyebrow">{title}</span>
      <span className="working-summary-branch" title={tree.path}>{location}</span>
    </div>
    {summary.inaccessible ? <p className="working-summary-status">Status unavailable</p> : summary.clean ? <p className="working-summary-status clean">Clean</p> : <div className="working-summary-stats" aria-label={`${summary.files} files, ${summary.additions} additions, ${summary.deletions} deletions`}>
      <span className="working-summary-stat files"><strong>{summary.files}</strong><span>files</span></span>
      <span className="working-summary-stat additions"><strong>+{summary.additions}</strong><span>additions</span></span>
      <span className="working-summary-stat deletions"><strong>−{summary.deletions}</strong><span>deletions</span></span>
    </div>}
  </aside>;
}
