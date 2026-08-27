import type { GraphNode } from '../../../src/model/graphModel';

function kindLabel(kind: GraphNode['kind']): string {
  if (kind === 'working-tree') return 'Working tree';
  if (kind === 'operation') return 'Operation in progress';
  if (kind === 'reflog-commit') return 'Reflog-only commit';
  if (kind === 'fast-forward-event') return 'Fast-forward event';
  if (kind === 'history-event') return 'History event';
  if (kind === 'history-boundary') return 'History boundary';
  return 'Commit';
}

export function CommitRow({ node, rowHeight, selected, onSelect }: { node: GraphNode; rowHeight: number; selected: boolean; onSelect: (oid: string) => void }) {
  const isSelectable = Boolean(node.oid && (node.kind === 'commit' || node.kind === 'reflog-commit'));
  const content = <div className={`row-content ${selected ? 'selected' : ''}`}>
    <div className="row-primary"><span className="row-kind">{kindLabel(node.kind)}</span><span className="subject">{node.label ?? node.subject ?? ''}</span></div>
    <div className="row-meta">{node.oid && <code>{node.oid.slice(0, 8)}</code>}{node.refIds.map((ref) => <span className="ref-badge" key={ref}>{ref}</span>)}</div>
  </div>;
  return <div className={`commit-row row-${node.kind}`} style={{ top: (node.row ?? 0) * rowHeight, minHeight: rowHeight }}>
    {isSelectable ? <button type="button" className="row-button" aria-label={`${kindLabel(node.kind)} ${node.subject ?? node.label ?? node.oid}`} onClick={() => onSelect(node.oid!)}>{content}</button> : content}
  </div>;
}
