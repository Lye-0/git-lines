import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphNode } from '../../src/model/graphModel';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../src/webview/messageProtocol';
import type { DetailEventMessage, DetailMessage, GraphMessage } from './types';
import { DetailPanel } from './components/DetailPanel';
import { EmptyState } from './components/EmptyState';
import { GraphViewport } from './components/GraphViewport';
import { Toolbar } from './components/Toolbar';
import { resolveDetailRefBadges } from './components/detailPresentation';
import { routeNameForNode } from './components/routePresentation';

const vscode = window.acquireVsCodeApi();

export function App() {
  const [graph, setGraph] = useState<GraphMessage | undefined>();
  const [detail, setDetail] = useState<DetailMessage>(null);
  const [detailEvent, setDetailEvent] = useState<DetailEventMessage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string }>();
  const [selected, setSelected] = useState<string>();
  const [selectedEvent, setSelectedEvent] = useState<string>();
  const [filter, setFilter] = useState('');
  const handleLoadMore = useCallback(() => vscode.postMessage({ type: 'loadMore' }), []);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      if (message.type === 'graph') { setGraph(message); setError(undefined); }
      if (message.type === 'loading') setLoading(Boolean(message.loading));
      if (message.type === 'error') setError({ title: message.title, detail: message.detail });
      if (message.type === 'detail') { setDetail(message.detail); setDetailEvent(message.event ?? undefined); }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' } satisfies WebviewToExtensionMessage);
    return () => window.removeEventListener('message', listener);
  }, []);
  const selectedNode = useMemo<GraphNode | undefined>(() => graph?.layout.nodes.find((node) => node.oid === selected), [graph, selected]);
  const selectedEventNode = useMemo<GraphNode | undefined>(() => graph?.layout.nodes.find((node) => node.id === selectedEvent), [graph, selectedEvent]);
  const detailNode = selectedNode ?? selectedEventNode;
  const detailRefBadges = useMemo(() => resolveDetailRefBadges(detailNode, graph?.layout.tracks ?? []), [graph, detailNode]);
  const detailRouteName = routeNameForNode(detailNode, graph?.layout.tracks ?? []);
  return <main className="app-shell">
    <Toolbar graph={graph} loading={loading} filter={filter} onFilter={setFilter} onRefresh={() => vscode.postMessage({ type: 'refresh' })} onLoadMore={handleLoadMore} onReflog={(enabled) => vscode.postMessage({ type: 'toggleReflog', enabled })} onDensity={(density) => vscode.postMessage({ type: 'setDensity', density })} />
    {error ? <EmptyState title={error.title} detail={error.detail} /> : graph ? <div className="content-shell"><div className="graph-content"><GraphViewport layout={graph.layout} loading={loading} onLoadMore={handleLoadMore} filter={filter} selected={selected} selectedEvent={selectedEvent} showWorkingTreeStats={!detail && !detailEvent} onSelect={(oid) => { setSelected(oid); setSelectedEvent(undefined); vscode.postMessage({ type: 'select', oid }); }} onSelectEvent={(id) => { setSelected(undefined); setSelectedEvent(id); vscode.postMessage({ type: 'selectEvent', id }); }} /></div>{(detail || detailEvent) && <DetailPanel detail={detail ?? undefined} event={detailEvent} title={detailNode?.subject} routeName={detailRouteName} refBadges={detailRefBadges} onClose={() => { setDetail(null); setDetailEvent(undefined); setSelected(undefined); setSelectedEvent(undefined); }} />}</div> : <EmptyState title="Loading repository" detail="Reading Git refs, history, and working tree state…" />}
  </main>;
}
