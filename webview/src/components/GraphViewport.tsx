import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { GraphSvg } from './GraphSvg';
import { CommitRow } from './CommitRow';
import { changesColumnStartForLayout, graphWidthForLayout, timelineContentWidthForLayout, TIMELINE_MIN_WIDTH } from './graphMetrics';
import { routeNameForNode } from './routePresentation';
import { linkedWorktreeStatusLabel, operationInProgressLabel } from './workingTreePresentation';

interface Props {
  layout: GraphLayout;
  filter: string;
  selected?: string;
  selectedWorkingTree?: string;
  selectedEvent?: string;
  showWorkingTreeStats?: boolean;
  onSelect: (oid: string) => void;
  onSelectWorkingTree: (id: string) => void;
  onSelectEvent: (id: string) => void;
  loading: boolean;
  onLoadMore: () => void;
}

export function GraphViewport({ layout, filter, selected, selectedWorkingTree, selectedEvent, showWorkingTreeStats = true, onSelect, onSelectWorkingTree, onSelectEvent, loading, onLoadMore }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const loadGate = useRef(true);
  const lastLayoutKey = useRef<string>();
  // A branch identity can occupy more than one reusable lane over time.  The
  // rendered nodes are the source of truth for the width that the SVG needs;
  // using only a track's representative lane could either clip a later
  // segment or reserve width for a track with no visible segment.
  const graphWidth = graphWidthForLayout(layout);
  const requiredChangesColumnStart = changesColumnStartForLayout(layout);
  // The graph/content boundary is determined by branch lanes only.  Ref event
  // labels are compacted inside the SVG and must never widen this column.
  // Keep the content and fixed changes columns usable at any viewport size;
  // the graph-scroll container provides horizontal scrolling below this
  // minimum instead of collapsing rows or hiding stats.
  const canvasMinWidth = Math.max(TIMELINE_MIN_WIDTH, graphWidth + timelineContentWidthForLayout(layout));
  // Use the scrollable canvas width for event labels as well. A narrow
  // viewport must not make an otherwise readable event label compact before
  // the user has a chance to scroll horizontally.
  const eventLabelWidth = Math.max(canvasMinWidth, viewportWidth || graphWidth);
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
    <div ref={scrollRef} className="graph-scroll" role="region" aria-label="Scrollable Git Lines graph" aria-busy={loading} tabIndex={0}>
      <div className="graph-canvas" style={{ minWidth: canvasMinWidth, minHeight: canvasHeight }}>
        <GraphSvg layout={layout} width={graphWidth} height={canvasHeight} selected={selected} selectedWorkingTree={selectedWorkingTree} />
        <div className="rows" style={{ marginLeft: graphWidth, width: `calc(100% - ${graphWidth}px)`, minHeight: canvasHeight, '--required-changes-column-start': `${requiredChangesColumnStart}px` } as CSSProperties}>
          {layout.nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0)).map((node) => { const tree = node.workingTree; const routeName = routeNameForNode(node, layout.tracks); const operationLabel = node.operation ? operationInProgressLabel(node.operation) : undefined; const linkedWorktreeTerms = (node.linkedWorktrees ?? []).flatMap((linked) => ['linked worktree', linked.branch, linked.path, linkedWorktreeStatusLabel(linked)]); const haystack = [node.subject, node.label, node.oid, routeName, tree?.branch, tree?.path, tree?.detached ? 'detached' : '', tree?.clean ? 'clean' : '', operationLabel, ...linkedWorktreeTerms, ...(node.operation?.sourceOids ?? []), ...node.refIds, ...(node.refBadges?.map((badge) => badge.fullName) ?? [])].filter(Boolean).join(' ').toLocaleLowerCase(); const selectable = node.kind === 'commit' || node.kind === 'reflog-commit'; const selectableWorkingTree = node.kind === 'working-tree'; const selectableEvent = Boolean(node.event && (node.kind === 'fast-forward-event' || node.kind === 'history-event')); return <CommitRow key={node.id} node={node} rowHeight={layout.rowHeight} tracks={layout.tracks} eventLabelWidth={eventLabelWidth} eventLabelX={graphWidth} selected={(selectable && node.oid === selected) || (selectableWorkingTree && node.id === selectedWorkingTree)} selectedEvent={selectableEvent && node.id === selectedEvent} hidden={Boolean(needle) && !haystack.includes(needle)} showWorkingTreeStats={showWorkingTreeStats} onSelect={onSelect} onSelectWorkingTree={onSelectWorkingTree} onSelectEvent={onSelectEvent} />; })}
        </div>
      </div>
    </div>
  </section>;
}
