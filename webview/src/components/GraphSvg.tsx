import type { ReactNode } from 'react';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode, routeEdges } from '../../../src/layout/edgeRouter';
import { filterRenderableEdgePaths } from '../../../src/layout/edgeVisibility';
import { branchColor } from '../../../src/utils/color';
import { gradientForEdge } from './edgePresentation';
import { eventTooltip, isRefEvent } from './eventPresentation';
import { createGraphColorResolver } from './graphColor';
import { isLinkedWorktreeCommit, isSelectedCommit, isUnsyncedCommit, nodeFillStyle, unsyncedGradientForNode } from './nodePresentation';

function renderNodeSymbol(node: GraphLayout['nodes'][number], fill?: string): ReactNode {
  if (node.kind === 'commit') {
    const linked = isLinkedWorktreeCommit(node);
    const className = `node-symbol node-dot${linked ? ' node-linked-worktree' : ''}${fill ? ' node-unsynced' : ''}`;
    return linked
      ? <rect className={className} x="-6.5" y="-6.5" width="13" height="13" rx="2" style={nodeFillStyle(fill)} />
      : <circle className={className} r="6.5" style={nodeFillStyle(fill)} />;
  }
  if (node.kind === 'working-tree' || node.kind === 'operation') return <circle className="node-symbol node-hollow" r="6.5" />;
  if (node.kind === 'fast-forward-event' || node.kind === 'history-event') {
    return <path className="node-symbol node-diamond" d="M 0 -6.5 L 6.5 0 L 0 6.5 L -6.5 0 Z" />;
  }
  const symbol = node.kind === 'reflog-commit' ? '◌' : '⋯';
  return <text className="node-symbol node-symbol-text" x="0" y="1" textAnchor="middle" fill="currentColor">{symbol}</text>;
}

export function GraphSvg({ layout, width, height, selected, selectedWorkingTree }: { layout: GraphLayout; width: number; height?: number; selected?: string; selectedWorkingTree?: string }) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const colorResolver = createGraphColorResolver(layout);
  const opacityByTrack = new Map(layout.tracks.map((track) => [track.id, track.kind === 'remote' ? 0.64 : 1]));
  const unsyncedGradients = layout.nodes.flatMap((node, index) => {
    const id = `node-sync-gradient-${index}-${node.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const gradient = unsyncedGradientForNode(node, colorResolver.colorForNode(node), id);
    return gradient ? [{ nodeId: node.id, ...gradient }] : [];
  });
  const unsyncedGradientByNodeId = new Map(unsyncedGradients.map((gradient) => [gradient.nodeId, gradient]));
  const point = (id: string) => pointForNode(byId.get(id)!, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
  const paths = layout.edgePaths ?? routeEdges(layout.nodes, layout.edges, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
  const visiblePaths = filterRenderableEdgePaths(paths, layout.edges, layout.nodes);
  const gradients = visiblePaths.flatMap((edge, index) => {
    const definition = edgeById.get(edge.edgeId ?? edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    if (!definition || !source || !target) return [];
    const sourceColor = colorResolver.colorForNode(source);
    const targetColor = colorResolver.colorForNode(target);
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
    const definition = edgeById.get(edge.edgeId ?? edge.id);
    const source = definition ? byId.get(definition.fromNodeId) : undefined;
    const target = definition ? byId.get(definition.toNodeId) : undefined;
    const annotation = definition?.annotation === 'ref-event' || edge.annotation === 'ref-event';
    const track = annotation ? target?.trackId ?? source?.trackId : source?.trackId;
    const baseOpacity = opacityByTrack.get(track ?? '') ?? 1;
    const muted = source?.kind === 'reflog-commit' || target?.kind === 'reflog-commit';
    const gradient = gradientByEdgeId.get(edge.id);
    const stroke = gradient
      ? `url(#${gradient.id})`
      : definition
        ? colorResolver.colorForEdge(definition, annotation ? 'target' : 'source')
        : branchColor('main');
    return <path key={edge.id} d={edge.d} className={`edge edge-${edge.type}${annotation ? ' edge-ref-annotation' : ''}${muted ? ' edge-reflog' : ''}`} stroke={stroke} opacity={muted ? baseOpacity * 0.68 : baseOpacity} />;
  };
  const renderNode = (node: (typeof layout.nodes)[number]) => {
    const p = point(node.id);
    const track = colorResolver.colorForNode(node);
    const refEvent = isRefEvent(node);
    const title = refEvent ? eventTooltip(node) : node.label ?? node.subject;
    const isSelected = isSelectedCommit(node, selected) || node.id === selectedWorkingTree;
    const usesVectorSymbol = node.kind === 'commit' || node.kind === 'working-tree' || node.kind === 'operation' || refEvent;
    const nodeMaskRadius = node.kind === 'reflog-commit' ? 8 : 6;
    const syncGradient = unsyncedGradientByNodeId.get(node.id);
    return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}${isSelected ? ' node-selected' : ''}`} color={track} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}>
      {title && <title>{title}</title>}
      {!usesVectorSymbol && <circle className="node-mask" r={nodeMaskRadius} aria-hidden="true" />}
      {isSelected && <circle className="node-ring" r="10" fill="none" stroke={track} />}
      {renderNodeSymbol(node, syncGradient ? `url(#${syncGradient.id})` : undefined)}
    </g>;
  };
  const canvasHeight = height ?? Math.max(50, layout.nodes.reduce((max, node) => Math.max(max, (node.row ?? 0) + 1), 0) * layout.rowHeight);
  return <svg className="graph-svg" width={width} height={canvasHeight} aria-hidden="true">
    {(gradients.length > 0 || unsyncedGradients.length > 0) && <defs>
      {gradients.map((gradient) => <linearGradient key={gradient.id} id={gradient.id} gradientUnits="userSpaceOnUse" x1={gradient.sourcePoint.x} y1={gradient.sourcePoint.y} x2={gradient.targetPoint.x} y2={gradient.targetPoint.y}>
        <stop offset="0%" stopColor={gradient.sourceColor} />
        <stop offset="100%" stopColor={gradient.targetColor} />
      </linearGradient>)}
      {unsyncedGradients.map((gradient) => <linearGradient key={gradient.id} id={gradient.id} gradientUnits="objectBoundingBox" x1={gradient.x1} y1={gradient.y1} x2={gradient.x2} y2={gradient.y2}>
        {gradient.stops.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor={gradient.color} stopOpacity={stop.opacity} />)}
      </linearGradient>)}
    </defs>}
    <g className="graph-edges">{visiblePaths.map(renderEdge)}</g>
    <g className="graph-node-masks" aria-hidden="true">
      {layout.nodes.filter((node) => isUnsyncedCommit(node)).map((node) => {
        const p = point(node.id);
        return isLinkedWorktreeCommit(node)
          ? <rect key={`node-mask-${node.id}`} className="node-mask node-unsynced-mask" transform={`translate(${p.x},${p.y})`} x="-6.5" y="-6.5" width="13" height="13" rx="2" />
          : <circle key={`node-mask-${node.id}`} className="node-mask node-unsynced-mask" transform={`translate(${p.x},${p.y})`} r="6.5" />;
      })}
    </g>
    <g className="graph-nodes">{layout.nodes.map(renderNode)}</g>
  </svg>;
}
