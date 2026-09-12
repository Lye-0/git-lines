import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitCommit } from '../../src/git/gitTypes';
import type { GraphNode } from '../../src/model/graphModel';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../src/webview/messageProtocol';
import type { DetailEventMessage, DetailMessage, GraphMessage } from './types';
import { SidebarDetailPopover } from './components/SidebarDetailPopover';
import { DetailPanel } from './components/DetailPanel';
import { EmptyState } from './components/EmptyState';
import { GraphViewport } from './components/GraphViewport';
import { Toolbar } from './components/Toolbar';
import { resolveDetailRefBadges } from './components/detailPresentation';
import { routeNameForNode } from './components/routePresentation';
import { allOverlayRelations } from '../../src/model/graphModel';

const vscode = window.acquireVsCodeApi();

export function App() {
  const [graph, setGraph] = useState<GraphMessage | undefined>();
  const receivedAt = useRef(0);
  const sidebar = graph?.presentation === 'sidebar';
  const sidebarRef = useRef(false);
  sidebarRef.current = sidebar;
  const selectionRef = useRef<string>();
  const [anchor, setAnchor] = useState({ top: 60, bottom: 88 });
  useEffect(() => {
    if (graph?.requestId === undefined) return;
    const received = receivedAt.current;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => vscode.postMessage({ type: 'rendered', requestId: graph.requestId!, renderMs: performance.now() - received } satisfies WebviewToExtensionMessage));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [graph]);
  const [detail, setDetail] = useState<DetailMessage>(null);
  const [detailEvent, setDetailEvent] = useState<DetailEventMessage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string }>();
  const [selected, setSelected] = useState<string>();
  const [selectedWorkingTree, setSelectedWorkingTree] = useState<string>();
  const [selectedEvent, setSelectedEvent] = useState<string>();
  const [filter, setFilter] = useState('');
  const handleLoadMore = useCallback(() => vscode.postMessage({ type: 'loadMore' }), []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      if (message.type === 'graph') {
        if (sidebarRef.current) { selectionRef.current = undefined; setSelected(undefined); setSelectedWorkingTree(undefined); setSelectedEvent(undefined); setDetail(null); setDetailEvent(undefined); }
        receivedAt.current = performance.now(); setGraph(message); setError(undefined);
      }
      if (message.type === 'loading') setLoading(Boolean(message.loading));
      if (message.type === 'error') setError({ title: message.title, detail: message.detail });
      if (message.type === 'detail') { if (sidebarRef.current && (message.detail || message.event) && (message.detail?.oid ?? message.event?.id) !== selectionRef.current) return; setDetail(message.detail); setDetailEvent(message.event ?? undefined); }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' } satisfies WebviewToExtensionMessage);
    return () => window.removeEventListener('message', listener);
  }, []);
  const selectedNode = useMemo<GraphNode | undefined>(() => graph?.layout.nodes.find((node) => node.oid === selected), [graph, selected]);
  const selectedWorkingNode = useMemo<GraphNode | undefined>(() => graph?.layout.nodes.find((node) => node.id === selectedWorkingTree && node.kind === 'working-tree'), [graph, selectedWorkingTree]);
  const selectedEventNode = useMemo<GraphNode | undefined>(() => graph?.layout.nodes.find((node) => node.id === selectedEvent), [graph, selectedEvent]);
  const selectedOverlay = useMemo(() => graph ? allOverlayRelations(graph.layout).find((relation) => relation.id === selectedEvent) : undefined, [graph, selectedEvent]);
  const detailNode = selectedNode ?? selectedWorkingNode ?? selectedEventNode;
  const workingSourceCommits = useMemo<GitCommit[]>(() => {
    const sourceOids = selectedWorkingNode?.operation?.sourceOids ?? [];
    return sourceOids
      .map((oid) => graph?.layout.nodes.find((node) => node.oid === oid)?.commit)
      .filter((commit): commit is GitCommit => Boolean(commit));
  }, [graph, selectedWorkingNode]);
  const detailRefBadges = useMemo(() => resolveDetailRefBadges(detailNode, graph?.layout.tracks ?? []), [graph, detailNode]);
  const detailRouteName = routeNameForNode(detailNode, graph?.layout.tracks ?? []);
  const detailHeadState = selectedNode?.headState;
  const toolbar = <Toolbar graph={graph} loading={loading} filter={filter} onFilter={setFilter} onRefresh={() => vscode.postMessage({ type: 'refresh' })} onLoadMore={handleLoadMore} onReflog={(enabled) => vscode.postMessage({ type: 'toggleReflog', enabled })} onDensity={(density) => vscode.postMessage({ type: 'setDensity', density })} />;
  const closeDetail = () => { selectionRef.current = undefined; setDetail(null); setDetailEvent(undefined); setSelected(undefined); setSelectedWorkingTree(undefined); setSelectedEvent(undefined); };
  const detailContent = <DetailPanel detail={detail ?? undefined} event={detailEvent} overlayRelation={selectedOverlay} workingTree={selectedWorkingNode?.workingTree} operation={selectedWorkingNode?.operation} sourceCommits={workingSourceCommits} linkedWorktrees={detailNode?.linkedWorktrees} title={detailNode?.subject} routeName={detailRouteName} headState={detailHeadState} refBadges={detailRefBadges} onClose={closeDetail} />;
  return <main className={sidebar ? 'app-shell sidebar-mode' : 'app-shell'} onClickCapture={(event) => {
    if (!sidebar || (event.target as HTMLElement).closest('.sidebar-popover')) return;
    const row = (event.target as HTMLElement).closest('.commit-row, .operation-annotation-row');
    if (row) { const rect = row.getBoundingClientRect(); setAnchor({ top: rect.top, bottom: rect.bottom }); }
  }}>
    {!error && graph ? <div className="content-shell"><div className="graph-content"><GraphViewport compactSidebar={sidebar} header={toolbar} layout={graph.layout} loading={loading} onLoadMore={handleLoadMore} filter={filter} selected={selected} selectedWorkingTree={selectedWorkingTree} selectedEvent={selectedEvent} showWorkingTreeStats={!detail && !detailEvent && !selectedWorkingNode && !selectedOverlay} onSelect={(oid) => { selectionRef.current = oid; if (sidebar) { setDetail(null); setDetailEvent(undefined); } setSelected(oid); setSelectedWorkingTree(undefined); setSelectedEvent(undefined); vscode.postMessage({ type: 'select', oid }); }} onSelectWorkingTree={(id) => { selectionRef.current = id; setSelected(undefined); setSelectedWorkingTree(id); setSelectedEvent(undefined); setDetail(null); setDetailEvent(undefined); }} onSelectEvent={(id) => { selectionRef.current = id; setSelected(undefined); setSelectedWorkingTree(undefined); setSelectedEvent(id); setDetail(null); setDetailEvent(undefined); vscode.postMessage({ type: 'selectEvent', id }); }} /></div>{(detail || detailEvent || selectedWorkingNode || selectedOverlay || (sidebar && (selected || selectedEvent))) && (sidebar ? <SidebarDetailPopover anchor={anchor} onClose={closeDetail}>{detail || detailEvent || selectedWorkingNode || selectedOverlay ? detailContent : <div className="sidebar-detail-loading"><button className="close-button" onClick={closeDetail} aria-label="Close details">×</button><p role="status">Loading details…</p></div>}</SidebarDetailPopover> : detailContent)}</div> : <div className="empty-content">{toolbar}<EmptyState title={error?.title ?? "Loading repository"} detail={error ? error.detail : "Reading repository state…"} /></div>}
  </main>;
}
