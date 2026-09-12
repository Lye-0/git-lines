import type { CSSProperties } from 'react';
import { estimatedRefMovementBadgeWidth, pointForNode, refMovementBadgeOffset } from '../../../src/layout/edgeRouter';
import type { GraphLayout } from '../../../src/layout/layoutTypes';
import type { GraphTrack } from '../../../src/model/graphModel';
import { layoutGraphSideRefEndpoints } from './refMovementPresentation';

export function RefMovementEndpointBadges({ layout, tracks }: { layout: GraphLayout; tracks: GraphTrack[] }) {
  const endpoints = layoutGraphSideRefEndpoints(layout);
  if (endpoints.length === 0) return null;
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const leftByNode = new Map<string, number>();
  return <div className="ref-movement-endpoint-badges" aria-hidden="true">
    {endpoints.map((endpoint) => {
      const node = byId.get(endpoint.nodeId);
      if (!node) return null;
      const point = pointForNode(node, { rowHeight: layout.rowHeight, laneWidth: layout.laneWidth });
      const left = leftByNode.get(endpoint.nodeId) ?? (point.x + refMovementBadgeOffset());
      leftByNode.set(endpoint.nodeId, left + estimatedRefMovementBadgeWidth(endpoint.badge.name, endpoint.badge.kind, Boolean(endpoint.badge.isDefault)) + 5);
      const track = tracks.find((candidate) => candidate.refNames.includes(endpoint.badge.fullName))
        ?? tracks.find((candidate) => candidate.family === endpoint.badge.name);
      const style = {
        left,
        top: point.y,
        '--badge-color': track?.color,
      } as CSSProperties;
      return <span
        className={`ref-badge ref-badge-${endpoint.badge.kind} ref-movement-endpoint-badge${endpoint.badge.isDefault ? ' default' : ''}${endpoint.ghost ? ' ref-badge-ghost' : ''}`}
        style={style}
        key={`${endpoint.nodeId}:${endpoint.badge.fullName}`}
        title={endpoint.ghost ? `Previous ${endpoint.badge.name} position` : endpoint.badge.name}
      >{endpoint.badge.name}{endpoint.badge.isDefault ? ' · default' : ''}</span>;
    })}
  </div>;
}
