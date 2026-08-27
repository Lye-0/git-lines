import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode } from '../../../src/layout/edgeRouter';

function pathFor(fromX: number, fromY: number, toX: number, toY: number): string {
  const delta = Math.max(8, Math.abs(toY - fromY) * 0.42);
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + delta}, ${toX} ${toY - delta}, ${toX} ${toY}`;
}

export function GraphSvg({ layout, width, height }: { layout: GraphLayout; width: number; height?: number }) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const colorByTrack = new Map(layout.tracks.map((track) => [track.id, track.color]));
  const opacityByTrack = new Map(layout.tracks.map((track) => [track.id, track.kind === 'remote' ? 0.64 : 1]));
  const point = (id: string) => pointForNode(byId.get(id)!, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
  const paths = layout.edgePaths ?? layout.edges.map((edge) => { const from = point(edge.fromNodeId); const to = point(edge.toNodeId); return { ...edge, d: pathFor(from.x, from.y, to.x, to.y) }; });
  return <svg className="graph-svg" width={width} height={height ?? Math.max(50, layout.nodes.reduce((max, node) => Math.max(max, (node.row ?? 0) + 1), 0) * layout.rowHeight)} aria-hidden="true">
    {paths.map((edge) => { const track = byId.get(edgeById.get(edge.id)?.fromNodeId ?? '')?.trackId; return <path key={edge.id} d={edge.d} className={`edge edge-${edge.type}`} stroke={colorByTrack.get(track ?? '') ?? 'var(--graph-muted)'} opacity={opacityByTrack.get(track ?? '') ?? 1} />; })}
    {layout.nodes.map((node) => { const p = point(node.id); const track = colorByTrack.get(node.trackId ?? '') ?? 'var(--graph-muted)'; const symbol = node.kind === 'fast-forward-event' ? '◇' : node.kind === 'reflog-commit' ? '◌' : node.kind === 'history-boundary' ? '⋯' : node.kind === 'working-tree' || node.kind === 'operation' ? '○' : node.kind === 'history-event' ? '◇' : '●'; return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}`} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}><text x="0" y="1" textAnchor="middle" fill={track}>{symbol}</text></g>; })}
  </svg>;
}
