import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [viewportWidth, setViewportWidth] = useState(0);
  const loadGate = useRef(true);
  const lastLayoutKey = useRef<string>();
  const maxLane = Math.max(0, ...layout.tracks.map((track) => track.lane));
  const laneWidth = (maxLane + 1) * layout.laneWidth + 48;
  // The graph/content boundary is determined by branch lanes only.  Ref event
  // labels are compacted inside the SVG and must never widen this column.
  const graphWidth = Math.max(136, laneWidth);
  const canvasMinWidth = graphWidth + 240;
  const eventLabelWidth = Math.max(graphWidth, viewportWidth || graphWidth);
  const rowCount = Math.max(1, ...layout.nodes.map((node) => (node.row ?? 0) + 1));
  const canvasHeight = rowCount * layout.rowHeight;
  const loadThreshold = Math.max(layout.rowHeight * 3, 180);
  const layoutKey = `${layout.visibleCommitCount}:${layout.nodes.length}:${layout.hasMore ? 'more' : 'done'}`;
  const needle = filter.trim().toLocaleLowerCase();
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
    const updateViewportWidth = () => setViewportWidth(element.clientWidth);
    updateViewportWidth();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateViewportWidth);
    resizeObserver?.observe(element);
    const handleScroll = () => {
      const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (distanceToBottom > loadThreshold * 1.5) loadGate.current = true;
      checkForMore(element);
    };
    element.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => {
      resizeObserver?.disconnect();
      element.removeEventListener('scroll', handleScroll);
    };
  }, [checkForMore, loadThreshold]);

  return <section className="graph-section" aria-label="Git commit graph">
    <div ref={scrollRef} className="graph-scroll" role="region" aria-label="Scrollable branch graph" aria-busy={loading} tabIndex={0}>
      <div className="graph-canvas" style={{ minWidth: canvasMinWidth, minHeight: canvasHeight }}>
        <GraphSvg layout={layout} width={graphWidth} height={canvasHeight} selected={selected} />
        <div className="rows" style={{ marginLeft: graphWidth, minHeight: canvasHeight }}>
          {layout.nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0)).map((node) => { const tree = node.workingTree; const haystack = [node.subject, node.label, node.oid, tree?.branch, tree?.path, tree?.detached ? 'detached' : '', tree?.clean ? 'clean' : '', ...node.refIds, ...(node.refBadges?.map((badge) => badge.fullName) ?? [])].filter(Boolean).join(' ').toLocaleLowerCase(); const selectable = node.kind === 'commit' || node.kind === 'reflog-commit'; return <CommitRow key={node.id} node={node} rowHeight={layout.rowHeight} tracks={layout.tracks} eventLabelWidth={eventLabelWidth} eventLabelX={graphWidth} selected={selectable && node.oid === selected} hidden={Boolean(needle) && !haystack.includes(needle)} onSelect={onSelect} />; })}
        </div>
      </div>
    </div>
  </section>;
}
