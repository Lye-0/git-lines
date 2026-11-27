import { useLayoutEffect, useRef } from 'react';
import { FilterControl } from './FilterControl';
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
  const menu = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const dismiss = () => { if (menu.current) menu.current.open = false; };
    const outside = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        event.preventDefault(); dismiss(); menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', outside, true);
    document.addEventListener('wheel', outside, { capture: true, passive: true });
    document.addEventListener('keydown', keyboard);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', outside, true);
      document.removeEventListener('wheel', outside, true);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('blur', dismiss);
    };
  }, []);
  return <details ref={menu} className="legend-menu">
    <summary className="toolbar-button icon-button" aria-label="Show graph legend" title="Graph legend">?</summary>
    <div className="legend-popover" role="dialog" aria-label="Graph legend">
      <div><span className="legend-symbol commit-dot">●</span> Commit</div>
      <div><span className="legend-symbol work-dot">○</span> Working Tree / operation</div>
      <div><span className="legend-symbol reflog-dot">◌</span> Historical commit</div>
      <div><span className="legend-symbol ff-dot">◇</span> Ref event</div>
      <div><span className="legend-line legend-line-parent" /> Parent relationship</div>
      <div><span className="legend-line legend-line-operation" /> Working / operation</div>
      <div><span className="legend-line legend-line-event" /> Ref move</div>
      <div>Reflog Off hides operations and past commits. Proven branch flow stays.</div>
    </div>
  </details>;
}

export function Toolbar({ graph, loading, filter, onFilter, onRefresh, onLoadMore, onSettings }: Props) {
  const iconUri = document.querySelector<HTMLMetaElement>('meta[name="git-lines-icon"]')?.content;
  return <header className="toolbar">
    <div className="brand"><img className="brand-mark" src={iconUri} alt="" aria-hidden="true" /><div className="brand-text"><h1>Git Lines</h1><span className="repo-name" title={graph?.repository.root}>{graph?.repository.root ?? 'Repository'}</span></div></div>
    <div className="toolbar-actions"><FilterControl graph={graph} value={filter} onChange={onFilter} />
      {graph?.layout.hasMore && <button className="toolbar-button icon-button load-more-button" type="button" onClick={onLoadMore} disabled={loading}
        aria-label={loading ? 'Loading more commits' : 'Load more commits'} title={loading ? 'Loading more commits' : 'Load more commits'} aria-busy={loading}>
        {loading ? <svg className="load-more-spinner" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="28 13" /></svg>
          : <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M5.5 2.5v15M13.5 10v7M10 13.5h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="5.5" cy="6.5" r="2.3" fill="currentColor" />
          </svg>}
      </button>}
      <button className="toolbar-button icon-button" type="button" onClick={onSettings} aria-label="Graph settings" title="Settings">⚙︎</button>
      <GraphLegend />
      <button className="toolbar-button icon-button" type="button" onClick={onRefresh} aria-label="Refresh graph" title="Refresh">{loading ? '…' : '↻'}</button>
    </div>
  </header>;
}
