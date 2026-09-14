import type { GraphMessage } from '../types';

interface Props {
  graph?: GraphMessage;
  loading: boolean;
  filter: string;
  onFilter: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onSettings: () => void;
}

function GraphLegend() {
  return <details className="legend-menu">
    <summary className="toolbar-button icon-button" aria-label="Show graph legend" title="Graph legend">?</summary>
    <div className="legend-popover" role="dialog" aria-label="Graph legend">
      <div><span className="legend-symbol commit-dot">●</span> Commit</div>
      <div><span className="legend-symbol work-dot">○</span> Working Tree / operation</div>
      <div><span className="legend-symbol reflog-dot">◌</span> Historical commit</div>
      <div><span className="legend-symbol ff-dot">◇</span> Ref event</div>
      <div><span className="legend-line legend-line-parent" /> Parent relationship</div>
      <div><span className="legend-line legend-line-operation" /> Working / operation</div>
      <div><span className="legend-line legend-line-event" /> Ref move</div>
    </div>
  </details>;
}

export function Toolbar({ graph, loading, filter, onFilter, onRefresh, onLoadMore, onSettings }: Props) {
  const iconUri = document.querySelector<HTMLMetaElement>('meta[name="git-lines-icon"]')?.content;
  return <header className="toolbar">
    <div className="brand"><img className="brand-mark" src={iconUri} alt="" aria-hidden="true" /><div className="brand-text"><h1>Git Lines</h1><span className="repo-name" title={graph?.repository.root}>{graph?.repository.root ?? 'Repository'}</span></div></div>
    <div className="toolbar-actions"><label className="filter-label"><span className="sr-only">Filter commits and branches</span><input type="search" value={filter} onChange={(event) => onFilter(event.target.value)} placeholder="Filter commits or branches" /></label>
      {graph?.layout.hasMore && <button className="toolbar-button" type="button" onClick={onLoadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>}
      <button className="toolbar-button icon-button" type="button" onClick={onSettings} aria-label="Graph settings" title="Settings">⚙︎</button>
      <GraphLegend />
      <button className="toolbar-button icon-button" type="button" onClick={onRefresh} aria-label="Refresh graph" title="Refresh">{loading ? '…' : '↻'}</button>
    </div>
  </header>;
}
