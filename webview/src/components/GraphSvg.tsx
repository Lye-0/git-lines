import type { ReactNode } from 'react';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode } from '../../../src/layout/edgeRouter';
import { filterRenderableEdgePaths } from '../../../src/layout/edgeVisibility';
import { gradientForEdge } from './edgePresentation';
import { eventTooltip, isRefEvent } from './eventPresentation';

function pathFor(fromX: number, fromY: number, toX: number, toY: number): string {
  const delta = Math.min(56, Math.max(8, Math.abs(toY - fromY) * 0.28));
  return `M ${fromX} ${fromY} C ${fromX} ${fromY + delta}, ${toX} ${toY - delta}, ${toX} ${toY}`;
}

function annotationPath(_fromX: number, fromY: number, toX: number, toY: number): string {
  return `M ${toX} ${fromY} L ${toX} ${toY}`;
}

function renderNodeSymbol(node: GraphLayout['nodes'][number]): ReactNode {
  if (node.kind === 'commit') return <circle className="node-symbol node-dot" r="6.5" />;
  if (node.kind === 'working-tree' || node.kind === 'operation') return <circle className="node-symbol node-hollow" r="6.5" />;
  if (node.kind === 'fast-forward-event' || node.kind === 'history-event') {
    return <path className="node-symbol node-diamond" d="M 0 -6.5 L 6.5 0 L 0 6.5 L -6.5 0 Z" />;
  }
  const symbol = node.kind === 'reflog-commit' ? '◌' : '⋯';
  return <text className="node-symbol node-symbol-text" x="0" y="1" textAnchor="middle" fill="currentColor">{symbol}</text>;
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
    return [{ ...edge, d: edge.annotation === 'ref-event' ? annotationPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y) : pathFor(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y) }];
  });
  const visiblePaths = filterRenderableEdgePaths(paths, layout.edges, layout.nodes);
  const gradients = visiblePaths.flatMap((edge, index) => {
    const definition = edgeById.get(edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    if (!definition || !source || !target) return [];
    const sourceColor = source.trackId ? colorByTrack.get(source.trackId) : undefined;
    const targetColor = target.trackId ? colorByTrack.get(target.trackId) : undefined;
    const gradient = gradientForEdge({
      edge: definition,
      source,
      target,
      sourceColor,
      targetColor,
      id: `edge-gradient-${index}-${edge.id.replace(/[^A-Za-z0-9_-]/g, '-')}`,
    });
    if (!gradient) return [];
    return [{
      edgeId: edge.id,
      ...gradient,
      sourcePoint: point(definition.fromNodeId),
      targetPoint: point(definition.toNodeId),
    }];
  });
  const gradientByEdgeId = new Map(gradients.map((gradient) => [gradient.edgeId, gradient]));
  const renderEdge = (edge: (typeof visiblePaths)[number]) => {
    const definition = edgeById.get(edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    const annotation = definition?.annotation === 'ref-event' || edge.annotation === 'ref-event';
    const track = annotation ? target?.trackId ?? source?.trackId : source?.trackId;
    const baseOpacity = opacityByTrack.get(track ?? '') ?? 1;
    const muted = source?.kind === 'reflog-commit' || target?.kind === 'reflog-commit';
    const gradient = gradientByEdgeId.get(edge.id);
    const stroke = gradient ? `url(#${gradient.id})` : colorByTrack.get(track ?? '') ?? 'var(--graph-muted)';
    return <path key={edge.id} d={edge.d} className={`edge edge-${edge.type}${annotation ? ' edge-ref-annotation' : ''}${muted ? ' edge-reflog' : ''}`} stroke={stroke} opacity={muted ? baseOpacity * 0.68 : baseOpacity} />;
  };
  const renderNode = (node: (typeof layout.nodes)[number]) => {
    const p = point(node.id);
    const track = colorByTrack.get(node.trackId ?? '') ?? 'var(--graph-muted)';
    const refEvent = isRefEvent(node);
    const title = refEvent ? eventTooltip(node) : node.label ?? node.subject;
    const isSelected = Boolean(selected && (node.kind === 'commit' || node.kind === 'reflog-commit') && (node.id === `commit:${selected}` || node.oid === selected));
    const usesVectorSymbol = node.kind === 'commit' || node.kind === 'working-tree' || node.kind === 'operation' || refEvent;
    const nodeMaskRadius = node.kind === 'reflog-commit' ? 8 : 6;
    return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}${isSelected ? ' node-selected' : ''}`} color={track} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}>
      {title && <title>{title}</title>}
      {!usesVectorSymbol && <circle className="node-mask" r={nodeMaskRadius} aria-hidden="true" />}
      {isSelected && <circle className="node-ring" r="10" fill="none" stroke={track} />}
      {renderNodeSymbol(node)}
    </g>;
  };
  const canvasHeight = height ?? Math.max(50, layout.nodes.reduce((max, node) => Math.max(max, (node.row ?? 0) + 1), 0) * layout.rowHeight);
  return <svg className="graph-svg" width={width} height={canvasHeight} aria-hidden="true">
    {gradients.length > 0 && <defs>{gradients.map((gradient) => <linearGradient key={gradient.id} id={gradient.id} gradientUnits="userSpaceOnUse" x1={gradient.sourcePoint.x} y1={gradient.sourcePoint.y} x2={gradient.targetPoint.x} y2={gradient.targetPoint.y}>
      <stop offset="0%" stopColor={gradient.sourceColor} />
      <stop offset="100%" stopColor={gradient.targetColor} />
    </linearGradient>)}</defs>}
    <g className="graph-edges">{visiblePaths.map(renderEdge)}</g>
    <g className="graph-nodes">{layout.nodes.map(renderNode)}</g>
  </svg>;
}
