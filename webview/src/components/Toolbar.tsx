import type { GraphMessage } from '../types';

interface Props {
  graph?: GraphMessage;
  loading: boolean;
  filter: string;
  onFilter: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onReflog: (enabled: boolean) => void;
  onDensity: (density: 'comfortable' | 'compact') => void;
}

function GraphLegend() {
  return <details className="legend-menu">
    <summary className="toolbar-button icon-button" aria-label="Show graph legend" title="Graph legend">?</summary>
    <div className="legend-popover" role="dialog" aria-label="Graph legend">
      <div><span className="legend-symbol commit-dot">●</span> Commit</div>
      <div><span className="legend-symbol work-dot">○</span> Working Tree / operation</div>
      <div><span className="legend-symbol reflog-dot">◌</span> Reflog-only commit</div>
      <div><span className="legend-symbol ff-dot">◇</span> Ref event</div>
      <div><span className="legend-line legend-line-parent" /> Parent relationship</div>
      <div><span className="legend-line legend-line-operation" /> Working / operation</div>
      <div><span className="legend-line legend-line-event" /> Ref move</div>
    </div>
  </details>;
}

export function Toolbar({ graph, loading, filter, onFilter, onRefresh, onLoadMore, onReflog, onDensity }: Props) {
  return <header className="toolbar">
    <div className="brand"><span className="brand-mark" aria-hidden="true">╱</span><div><h1>Git Lines</h1><span className="repo-name">{graph?.repository.root ?? 'Repository'}</span></div></div>
    <div className="toolbar-actions"><label className="filter-label"><span className="sr-only">Filter commits and branches</span><input type="search" value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter commits or branches" /></label>
      <label className="toggle"><input type="checkbox" checked={graph?.reflogEnabled ?? true} onChange={(event) => onReflog(event.target.checked)} /><span>Reflog</span></label>
      <label className="select-label">Density<select value={graph?.density ?? 'comfortable'} onChange={(event) => onDensity(event.target.value as 'comfortable' | 'compact')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      {graph?.layout.hasMore && <button className="toolbar-button" type="button" onClick={onLoadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
      <GraphLegend />
      <button className="toolbar-button icon-button" type="button" onClick={onRefresh} aria-label="Refresh graph" title="Refresh">{loading ? '…' : '↻'}</button>
    </div>
  </header>;
}
