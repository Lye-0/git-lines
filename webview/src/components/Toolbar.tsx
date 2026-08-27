import type { GraphMessage } from '../types';

interface Props {
  graph?: GraphMessage;
  loading: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onReflog: (enabled: boolean) => void;
  onDensity: (density: 'comfortable' | 'compact') => void;
}

export function Toolbar({ graph, loading, onRefresh, onLoadMore, onReflog, onDensity }: Props) {
  return <header className="toolbar">
    <div className="brand"><span className="brand-mark" aria-hidden="true">╱</span><div><h1>Branch Graph</h1><span className="repo-name">{graph?.repository.root ?? 'Repository'}</span></div></div>
    <div className="toolbar-actions">
      <label className="toggle"><input type="checkbox" checked={graph?.reflogEnabled ?? true} onChange={(event) => onReflog(event.target.checked)} /><span>Reflog</span></label>
      <label className="select-label">Density<select value={graph?.density ?? 'comfortable'} onChange={(event) => onDensity(event.target.value as 'comfortable' | 'compact')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      {graph?.layout.hasMore && <button className="toolbar-button" type="button" onClick={onLoadMore}>Load more</button>}
      <button className="toolbar-button icon-button" type="button" onClick={onRefresh} aria-label="Refresh graph" title="Refresh">{loading ? '…' : '↻'}</button>
    </div>
  </header>;
}
