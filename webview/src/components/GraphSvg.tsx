import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode } from '../../../src/layout/edgeRouter';
import { filterRenderableEdgePaths } from '../../../src/layout/edgeVisibility';

function pathFor(fromX: number, fromY: number, toX: number, toY: number): string {
  const delta = Math.min(56, Math.max(8, Math.abs(toY - fromY) * 0.28));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + delta}, ${toX} ${toY - delta}, ${toX} ${toY}`;
}

function annotationPath(fromX: number, y: number, toX: number): string {
  return `M ${fromX} ${y} H ${toX}`;
}

export function GraphSvg({ layout, width, height, selected }: { layout: GraphLayout; width: number; height?: number; selected?: string }) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const colorByTrack = new Map(layout.tracks.map((track) => [track.id, track.color]));
  const opacityByTrack = new Map(layout.tracks.map((track) => [track.id, track.kind === 'remote' ? 0.64 : 1]));
  const point = (id: string) => pointForNode(byId.get(id)!, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
  const paths = layout.edgePaths ?? layout.edges.flatMap((edge) => {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) return [];
    const fromPoint = point(edge.fromNodeId);
    const toPoint = point(edge.toNodeId);
    return [{ ...edge, d: edge.annotation === 'ref-event' ? annotationPath(fromPoint.x, toPoint.y, toPoint.x) : pathFor(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y) }];
  });
  const visiblePaths = filterRenderableEdgePaths(paths, layout.edges, layout.nodes);
  const renderEdge = (edge: (typeof visiblePaths)[number]) => {
    const definition = edgeById.get(edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    const annotation = definition?.annotation === 'ref-event' || edge.annotation === 'ref-event';
    const track = annotation ? target?.trackId ?? source?.trackId : source?.trackId;
    const baseOpacity = opacityByTrack.get(track ?? '') ?? 1;
    const muted = source?.kind === 'reflog-commit' || target?.kind === 'reflog-commit';
    return <path key={edge.id} d={edge.d} className={`edge edge-${edge.type}${annotation ? ' edge-ref-annotation' : ''}${muted ? ' edge-reflog' : ''}`} stroke={colorByTrack.get(track ?? '') ?? 'var(--graph-muted)'} opacity={muted ? baseOpacity * 0.68 : baseOpacity} />;
  };
  const renderNode = (node: (typeof layout.nodes)[number]) => {
    const p = point(node.id);
    const track = colorByTrack.get(node.trackId ?? '') ?? 'var(--graph-muted)';
    const refEvent = node.kind === 'fast-forward-event' || node.kind === 'history-event';
    const symbol = node.kind === 'fast-forward-event' ? '◇' : node.kind === 'reflog-commit' ? '◌' : node.kind === 'history-boundary' ? '⋯' : node.kind === 'working-tree' || node.kind === 'operation' ? '○' : node.kind === 'history-event' ? '◇' : '●';
    const isSelected = Boolean(selected && (node.kind === 'commit' || node.kind === 'reflog-commit') && (node.id === `commit:${selected}` || node.oid === selected));
    return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}${isSelected ? ' node-selected' : ''}`} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}>
      {(node.label || node.subject) && <title>{node.label ?? node.subject}{node.subject && node.label && node.subject !== node.label ? `\n${node.subject}` : ''}</title>}
      {isSelected && <circle className="node-ring" r="10" fill="none" stroke={track} />}
      <text className="node-symbol" x="0" y="1" textAnchor="middle" fill={track}>{symbol}</text>
      {refEvent && <text className="node-event-label" x="12" y="4" textAnchor="start" fill={track}>{node.label ?? node.subject}</text>}
    </g>;
  };
  const canvasHeight = height ?? Math.max(50, layout.nodes.reduce((max, node) => Math.max(max, (node.row ?? 0) + 1), 0) * layout.rowHeight);
  return <svg className="graph-svg" width={width} height={canvasHeight} aria-hidden="true">
    {visiblePaths.map(renderEdge)}
    {layout.nodes.map(renderNode)}
  </svg>;
}
