import { useCallback, useEffect, useRef } from 'react';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { GraphSvg } from './GraphSvg';
import { CommitRow } from './CommitRow';

interface Props {
  layout: GraphLayout;
  filter: string;
  selected?: string;
  onSelect: (oid: string) => void;
  loading: boolean;
  onLoadMore: () => void;
}

export function GraphViewport({ layout, filter, selected, onSelect, loading, onLoadMore }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadGate = useRef(true);
  const lastLayoutKey = useRef<string>();
  const maxLane = Math.max(0, ...layout.nodes.map((node) => node.lane ?? 0));
  const graphWidth = Math.max(136, (maxLane + 1) * layout.laneWidth + 48);
  const canvasMinWidth = graphWidth + 240;
  const rowCount = Math.max(1, ...layout.nodes.map((node) => (node.row ?? 0) + 1));
  const canvasHeight = rowCount * layout.rowHeight;
  const loadThreshold = Math.max(layout.rowHeight * 3, 180);
  const layoutKey = `${layout.visibleCommitCount}:${layout.nodes.length}:${layout.hasMore ? 'more' : 'done'}`;
  const checkForMore = useCallback((element: HTMLDivElement | null = scrollRef.current) => {
    if (!element || loading || !layout.hasMore || !loadGate.current) return;
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceToBottom <= loadThreshold) {
      loadGate.current = false;
      onLoadMore();
    }
  }, [layout.hasMore, loading, loadThreshold, onLoadMore]);

  // Re-check after a successful page append. If the page still does not fill
  // the viewport, continue loading until it does or Git reports no more data.
  useEffect(() => {
    if (loading || lastLayoutKey.current === layoutKey) return;
    lastLayoutKey.current = layoutKey;
    loadGate.current = true;
    checkForMore();
  }, [checkForMore, layoutKey, loading]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const handleScroll = () => {
      const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (distanceToBottom > loadThreshold * 1.5) loadGate.current = true;
      checkForMore(element);
    };
    element.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => element.removeEventListener('scroll', handleScroll);
  }, [checkForMore, loadThreshold]);

  return <section className="graph-section" aria-label="Git commit graph">
    <div ref={scrollRef} className="graph-scroll" role="region" aria-label="Scrollable branch graph" aria-busy={loading} tabIndex={0}>
      <div className="graph-canvas" style={{ minWidth: canvasMinWidth, minHeight: canvasHeight }}>
        <GraphSvg layout={layout} width={graphWidth} height={canvasHeight} />
        <div className="rows" style={{ marginLeft: graphWidth, minHeight: canvasHeight }}>
          {layout.nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0)).map((node) => { const needle = filter.trim().toLocaleLowerCase(); const haystack = [node.subject, node.label, node.oid, ...node.refIds].filter(Boolean).join(' ').toLocaleLowerCase(); return <CommitRow key={node.id} node={node} rowHeight={layout.rowHeight} selected={node.oid === selected} hidden={Boolean(needle) && !haystack.includes(needle)} onSelect={onSelect} />; })}
        </div>
      </div>
    </div>
    <div className="legend" aria-label="Graph legend"><span><i className="legend-dot commit-dot">●</i> Commit</span><span><i className="legend-dot work-dot">○</i> Working tree / operation</span><span><i className="legend-dot reflog-dot">◌</i> Reflog-only</span><span><i className="legend-dot ff-dot">◇</i> Ref event</span></div>
  </section>;
}
