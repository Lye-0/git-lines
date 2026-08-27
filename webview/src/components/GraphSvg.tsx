import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode } from '../../../src/layout/edgeRouter';
import { filterRenderableEdgePaths } from '../../../src/layout/edgeVisibility';

function pathFor(fromX: number, fromY: number, toX: number, toY: number): string {
  const delta = Math.min(56, Math.max(8, Math.abs(toY - fromY) * 0.28));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + delta}, ${toX} ${toY - delta}, ${toX} ${toY}`;
}

export function GraphSvg({ layout, width, height, selected }: { layout: GraphLayout; width: number; height?: number; selected?: string }) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const colorByTrack = new Map(layout.tracks.map((track) => [track.id, track.color]));
  const opacityByTrack = new Map(layout.tracks.map((track) => [track.id, track.kind === 'remote' ? 0.64 : 1]));
  const point = (id: string) => pointForNode(byId.get(id)!, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
  const paths = layout.edgePaths ?? layout.edges.flatMap((edge) => {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (!from || !to) return [];
    return [{ ...edge, d: pathFor(point(edge.fromNodeId).x, point(edge.fromNodeId).y, point(edge.toNodeId).x, point(edge.toNodeId).y) }];
  });
  const visiblePaths = filterRenderableEdgePaths(paths, layout.edges, layout.nodes);
  const renderEdge = (edge: (typeof visiblePaths)[number]) => {
    const definition = edgeById.get(edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    const track = source?.trackId;
    const baseOpacity = opacityByTrack.get(track ?? '') ?? 1;
    const muted = source?.kind === 'reflog-commit' || target?.kind === 'reflog-commit';
    const eventTarget = edge.type === 'history-event' && edge.id.endsWith(':to');
    return <path key={edge.id} d={edge.d} className={`edge edge-${edge.type}${eventTarget ? ' edge-event-target' : ''}${muted ? ' edge-reflog' : ''}`} stroke={colorByTrack.get(track ?? '') ?? 'var(--graph-muted)'} opacity={muted ? baseOpacity * 0.68 : baseOpacity} />;
  };
  const renderNode = (node: (typeof layout.nodes)[number]) => {
    const p = point(node.id);
    const track = colorByTrack.get(node.trackId ?? '') ?? 'var(--graph-muted)';
    const symbol = node.kind === 'fast-forward-event' ? '◇' : node.kind === 'reflog-commit' ? '◌' : node.kind === 'history-boundary' ? '⋯' : node.kind === 'working-tree' || node.kind === 'operation' ? '○' : node.kind === 'history-event' ? '◇' : '●';
    const isSelected = Boolean(selected && (node.kind === 'commit' || node.kind === 'reflog-commit') && (node.id === `commit:${selected}` || node.oid === selected));
    return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}${isSelected ? ' node-selected' : ''}`} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}>{isSelected && <circle className="node-ring" r="9" fill="none" stroke={track} />}<text x="0" y="1" textAnchor="middle" fill={track}>{symbol}</text></g>;
  };
  const canvasHeight = height ?? Math.max(50, layout.nodes.reduce((max, node) => Math.max(max, (node.row ?? 0) + 1), 0) * layout.rowHeight);
  return <svg className="graph-svg" width={width} height={canvasHeight} aria-hidden="true">
    <defs><marker id="history-event-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 6 3 L 0 6 z" fill="var(--graph-muted)" /></marker></defs>
    {visiblePaths.map(renderEdge)}
    {layout.nodes.map(renderNode)}
  </svg>;
}
