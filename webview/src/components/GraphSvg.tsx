import type { GraphLayout } from '../../../src/layout/layoutTypes';

function pathFor(fromX: number, fromY: number, toX: number, toY: number): string {
  const delta = Math.max(8, Math.abs(toY - fromY) * 0.42);
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + delta}, ${toX} ${toY - delta}, ${toX} ${toY}`;
}

export function GraphSvg({ layout, width }: { layout: GraphLayout; width: number }) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const colorByTrack = new Map(layout.tracks.map((track) => [track.id, track.color]));
  const point = (id: string) => { const node = byId.get(id)!; return { x: 18 + (node.lane ?? 0) * layout.laneWidth, y: 18 + (node.row ?? 0) * layout.rowHeight }; };
  return <svg className="graph-svg" width={width} height={Math.max(50, layout.nodes.length * layout.rowHeight)} aria-hidden="true">
    {layout.edges.map((edge) => { const from = point(edge.fromNodeId); const to = point(edge.toNodeId); const track = byId.get(edge.fromNodeId)?.trackId; return <path key={edge.id} d={pathFor(from.x, from.y, to.x, to.y)} className={`edge edge-${edge.type}`} stroke={colorByTrack.get(track ?? '') ?? 'var(--graph-muted)'} />; })}
    {layout.nodes.map((node) => { const p = point(node.id); const track = colorByTrack.get(node.trackId ?? '') ?? 'var(--graph-muted)'; return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}`}><circle r={node.kind === 'working-tree' || node.kind === 'operation' ? 6 : 5} stroke={track} /><text x="0" y="1" textAnchor="middle">{node.kind === 'fast-forward-event' ? '◇' : node.kind === 'reflog-commit' ? '◌' : node.kind === 'working-tree' || node.kind === 'operation' ? '○' : '●'}</text></g>; })}
  </svg>;
}
