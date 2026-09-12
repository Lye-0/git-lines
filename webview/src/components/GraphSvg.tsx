import type { ReactNode } from 'react';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { pointForNode, routeCherryPickGroups, routeEdges, routeHistoryRelations, routeRebaseRelations, routeRefMovements, routeRewriteCollapseRelations } from '../../../src/layout/edgeRouter';
import { filterRenderableEdgePaths } from '../../../src/layout/edgeVisibility';
import { branchColor } from '../../../src/utils/color';
import { gradientForEdge } from './edgePresentation';
import { eventTooltip, isRefEvent } from './eventPresentation';
import { createGraphColorResolver } from './graphColor';
import { isSelectedCommit, isUnsyncedCommit, nodeFillStyle, nodeMarkGeometry, nodeRingGeometry, unsyncedGradientForNode } from './nodePresentation';
import { operationAnnotationTooltip, operationKindLabel, operationOverlayColor } from './operationPresentation';
import { allOverlayRelations } from '../../../src/model/graphModel';

function renderNodeSymbol(node: GraphLayout['nodes'][number], fill?: string): ReactNode {
  const mark = nodeMarkGeometry(node);
  const { center, radius, shape } = mark;
  if (shape === 'square') {
    const className = `node-symbol node-dot node-linked-worktree${fill ? ' node-unsynced' : ''}`;
    return <rect className={className} x={center.x - radius} y={center.y - radius} width={radius * 2} height={radius * 2} rx="2" style={nodeFillStyle(fill)} />;
  }
  if (shape === 'dot') {
    const className = `node-symbol node-dot${fill ? ' node-unsynced' : ''}`;
    return <circle className={className} cx={center.x} cy={center.y} r={radius} style={nodeFillStyle(fill)} />;
  }
  if (shape === 'hollow') return <circle className="node-symbol node-hollow" cx={center.x} cy={center.y} r={radius} />;
  if (shape === 'diamond') {
    return <path className="node-symbol node-diamond" d={`M ${center.x} ${center.y - radius} L ${center.x + radius} ${center.y} L ${center.x} ${center.y + radius} L ${center.x - radius} ${center.y} Z`} />;
  }
  return <text className="node-symbol node-symbol-text" x={center.x} y={center.y} textAnchor="middle" fill="currentColor">{mark.text}</text>;
}

export function GraphSvg({ layout, width, height, selected, selectedWorkingTree, selectedEvent, onSelectEvent }: { layout: GraphLayout; width: number; height?: number; selected?: string; selectedWorkingTree?: string; selectedEvent?: string; onSelectEvent?: (id: string) => void }) {
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
  const historyRelations = layout.historyRelations ?? [];
  const annotationRows = new Map((layout.operationAnnotationRows ?? []).map((row) => [row.relationId, row.row]));
  const relationPaths = layout.historyRelationPaths ?? routeHistoryRelations(layout.nodes, historyRelations, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth, annotationRows });
  const refMovementRelations = layout.refMovementRelations ?? [];
  const refMovementPaths = layout.refMovementPaths ?? routeRefMovements(layout.nodes, refMovementRelations, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth, annotationRows });
  const rebaseRelations = layout.rebaseRelations ?? [];
  const rebaseOverlay = layout.rebaseRelationPaths && layout.rebaseGroupOutlines
    ? { paths: layout.rebaseRelationPaths, outlines: layout.rebaseGroupOutlines }
    : routeRebaseRelations(layout.nodes, rebaseRelations, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth, annotationRows });
  const rebaseRelationPaths = rebaseOverlay.paths;
  const rebaseGroupOutlines = rebaseOverlay.outlines;
  const cherryPickGroupRelations = layout.cherryPickGroupRelations ?? [];
  const cherryPickOverlay = layout.cherryPickGroupPaths && layout.cherryPickGroupOutlines
    ? { paths: layout.cherryPickGroupPaths, outlines: layout.cherryPickGroupOutlines }
    : routeCherryPickGroups(layout.nodes, cherryPickGroupRelations, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth, annotationRows });
  const cherryPickGroupPaths = cherryPickOverlay.paths;
  const cherryPickGroupOutlines = cherryPickOverlay.outlines;
  const rewriteCollapseRelations = layout.rewriteCollapseRelations ?? [];
  const collapseOverlay = layout.rewriteCollapsePaths && layout.rewriteCollapseOutlines
    ? { paths: layout.rewriteCollapsePaths, outlines: layout.rewriteCollapseOutlines }
    : routeRewriteCollapseRelations(layout.nodes, rewriteCollapseRelations, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth, annotationRows });
  const rewriteCollapsePaths = collapseOverlay.paths;
  const rewriteCollapseOutlines = collapseOverlay.outlines;
  const relationById = new Map(allOverlayRelations({ historyRelations, refMovementRelations, rebaseRelations, cherryPickGroupRelations, rewriteCollapseRelations }).map((relation) => [relation.id, relation]));
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
    const mark = nodeMarkGeometry(node);
    const ring = nodeRingGeometry(node);
    const usesVectorSymbol = mark.shape !== 'text';
    const syncGradient = unsyncedGradientByNodeId.get(node.id);
    return <g key={node.id} transform={`translate(${p.x},${p.y})`} className={`node node-${node.kind}${isSelected ? ' node-selected' : ''}`} color={track} opacity={opacityByTrack.get(node.trackId ?? '') ?? 1}>
      {title && <title>{title}</title>}
      {!usesVectorSymbol && <circle className="node-mask" cx={mark.center.x} cy={mark.center.y} r={mark.radius} aria-hidden="true" />}
      {isSelected && <circle className="node-ring" cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke={track} />}
      {renderNodeSymbol(node, syncGradient ? `url(#${syncGradient.id})` : undefined)}
    </g>;
  };
  const renderHistoryRelationLines = (path: NonNullable<GraphLayout['historyRelationPaths']>[number] | NonNullable<GraphLayout['refMovementPaths']>[number]) => {
    const relation = relationById.get(path.relationId);
    if (!relation) return null;
    return <g key={path.id} className="history-relation-lines" color={operationOverlayColor(relation.kind)}>
      <path className="history-relation-path" d={path.d} pointerEvents="none" />
      {path.arrowD ? <path className="history-relation-arrow" d={path.arrowD} pointerEvents="none" /> : null}
      {'sourceMarkerD' in path && path.sourceMarkerD ? <path className="history-relation-cross" d={path.sourceMarkerD} pointerEvents="none" /> : null}
    </g>;
  };
  const renderHistoryRelationAnnotation = (path: NonNullable<GraphLayout['historyRelationPaths']>[number] | NonNullable<GraphLayout['refMovementPaths']>[number]) => {
    const relation = relationById.get(path.relationId);
    if (!relation) return null;
    const selectedRelation = selectedEvent === relation.id;
    const tooltip = operationAnnotationTooltip(relation);
    return <g key={`${path.id}:annotation`} className={`history-relation-annotation${selectedRelation ? ' selected' : ''}`} color={operationOverlayColor(relation.kind)} transform={`translate(${path.labelX},${path.labelY})`} onClick={() => onSelectEvent?.(relation.id)}>
      <title>{tooltip}</title>
      <path className="history-relation-diamond" d="M 0 -6 L 6 0 L 0 6 L -6 0 Z" />
      <text className="history-relation-label" x="10" y="1">{operationKindLabel(relation.kind)}</text>
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
    <g className="graph-rebase-group-outlines">{[...rebaseGroupOutlines, ...cherryPickGroupOutlines, ...rewriteCollapseOutlines].map((outline) => (
      <path key={outline.id} className={`rebase-group-outline rebase-group-outline-${outline.role}`} d={outline.d} pointerEvents="none" />
    ))}</g>
    <g className="graph-history-relation-lines">{relationPaths.map(renderHistoryRelationLines)}{refMovementPaths.map(renderHistoryRelationLines)}{rebaseRelationPaths.map(renderHistoryRelationLines)}{cherryPickGroupPaths.map(renderHistoryRelationLines)}{rewriteCollapsePaths.map(renderHistoryRelationLines)}</g>
    <g className="graph-node-masks" aria-hidden="true">
      {layout.nodes.filter((node) => isUnsyncedCommit(node)).map((node) => {
        const p = point(node.id);
        const mark = nodeMarkGeometry(node);
        return mark.shape === 'square'
          ? <rect key={`node-mask-${node.id}`} className="node-mask node-unsynced-mask" transform={`translate(${p.x},${p.y})`} x={mark.center.x - mark.radius} y={mark.center.y - mark.radius} width={mark.radius * 2} height={mark.radius * 2} rx="2" />
          : <circle key={`node-mask-${node.id}`} className="node-mask node-unsynced-mask" transform={`translate(${p.x},${p.y})`} cx={mark.center.x} cy={mark.center.y} r={mark.radius} />;
      })}
    </g>
    <g className="graph-nodes">{layout.nodes.map(renderNode)}</g>
    <g className="graph-history-relation-annotations">{relationPaths.map(renderHistoryRelationAnnotation)}{refMovementPaths.map(renderHistoryRelationAnnotation)}{rebaseRelationPaths.map(renderHistoryRelationAnnotation)}{cherryPickGroupPaths.map(renderHistoryRelationAnnotation)}{rewriteCollapsePaths.map(renderHistoryRelationAnnotation)}</g>
  </svg>;
}
