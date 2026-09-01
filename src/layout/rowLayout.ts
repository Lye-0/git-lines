import type { GraphEdge, GraphNode } from '../model/graphModel.js';

export type RowMap = Map<string, number>;

const kindPriority: Record<GraphNode['kind'], number> = {
  'working-tree': 0,
  operation: 1,
  'fast-forward-event': 2,
  'history-event': 3,
  commit: 4,
  'reflog-commit': 5,
  'history-boundary': 6,
};

function compareNodes(a: GraphNode, b: GraphNode): number {
  const timestamp = (b.timestamp ?? 0) - (a.timestamp ?? 0);
  if (timestamp !== 0) return timestamp;
  const kind = kindPriority[a.kind] - kindPriority[b.kind];
  if (kind !== 0) return kind;
  return a.id.localeCompare(b.id);
}

/** Topological ordering with a deterministic date-oriented ready queue. */
export function computeRowLayout(nodes: GraphNode[], edges: GraphEdge[], previousRows?: RowMap): { nodes: GraphNode[]; rows: RowMap } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const structuralNodes = nodes.filter((node) => node.kind !== 'fast-forward-event' && node.kind !== 'history-event');
  const structuralIds = new Set(structuralNodes.map((node) => node.id));
  const constrained = edges.filter((edge) => edge.type === 'parent' || edge.type === 'working-tree' || edge.type === 'operation');
  const indegree = new Map(structuralNodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of constrained) {
    if (!structuralIds.has(edge.fromNodeId) || !structuralIds.has(edge.toNodeId)) continue;
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }
  const existing = new Map<string, number>();
  for (const node of structuralNodes) {
    const row = previousRows?.get(node.id) ?? node.row;
    if (row !== undefined && ![...existing.values()].includes(row)) existing.set(node.id, row);
  }
  const result = new Map<string, number>(existing);
  const assigned = new Set(existing.keys());
  const ready = structuralNodes.filter((node) => !assigned.has(node.id) && (indegree.get(node.id) ?? 0) === 0).sort(compareNodes);
  let nextRow = Math.max(-1, ...result.values()) + 1;
  const pushReady = (nodeId: string) => {
    const node = byId.get(nodeId);
    if (!node || assigned.has(nodeId) || ready.some((candidate) => candidate.id === nodeId)) return;
    if ((indegree.get(nodeId) ?? 0) === 0) {
      ready.push(node);
      ready.sort(compareNodes);
    }
  };
  while (ready.length) {
    const node = ready.shift() as GraphNode;
    if (assigned.has(node.id)) continue;
    assigned.add(node.id);
    result.set(node.id, nextRow++);
    for (const target of outgoing.get(node.id) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      pushReady(target);
    }
  }
  for (const node of structuralNodes.filter((candidate) => !assigned.has(candidate.id)).sort(compareNodes)) {
    assigned.add(node.id);
    result.set(node.id, nextRow++);
  }

  // Ref events are not part of the structural topological sort, but they are
  // real timeline rows.  Insert each event immediately before its semantic
  // boundary while preserving the structural order and parent constraints.
  const eventAnchorById = new Map(edges
    .filter((edge) => edge.annotation === 'ref-event' && structuralIds.has(edge.fromNodeId))
    .map((edge) => [edge.toNodeId, edge.fromNodeId]));
  const commitIdByOid = new Map(structuralNodes
    .filter((node) => node.kind === 'commit' || node.kind === 'reflog-commit' || node.kind === 'history-boundary')
    .filter((node) => node.oid)
    .map((node) => [node.oid as string, node.id]));
  const eventNodes = nodes.filter((candidate) => !structuralIds.has(candidate.id)).sort(compareNodes);
  const anchorForEvent = (node: GraphNode): string | undefined => {
    const explicitBoundary = node.eventBoundaryCommitId && structuralIds.has(node.eventBoundaryCommitId) ? node.eventBoundaryCommitId : undefined;
    const destinationAnchor = node.anchorCommitId && structuralIds.has(node.anchorCommitId) ? node.anchorCommitId : undefined;
    const eventStart = node.eventStartCommitId && structuralIds.has(node.eventStartCommitId) ? node.eventStartCommitId : undefined;
    return explicitBoundary ?? destinationAnchor ?? eventStart ?? eventAnchorById.get(node.id) ?? (node.event?.toOid ? commitIdByOid.get(node.event.toOid) : undefined);
  };
  const structuralRowSet = new Set(result.values());
  const canReusePreviousTimeline = Boolean(previousRows && eventNodes.length > 0 && eventNodes.every((node) => {
    const previousRow = previousRows.get(node.id);
    if (previousRow === undefined || structuralRowSet.has(previousRow)) return false;
    const anchorId = anchorForEvent(node);
    const anchorRow = anchorId === undefined ? undefined : previousRows.get(anchorId);
    return anchorRow === undefined || previousRow < anchorRow;
  }));
  if (canReusePreviousTimeline) {
    // Appending an older commit page should not move the already visible
    // timeline.  Reuse event rows that were assigned on the previous page.
    for (const node of eventNodes) result.set(node.id, previousRows!.get(node.id) as number);
  } else if (eventNodes.length > 0) {
    const anchoredEvents = new Map<string, GraphNode[]>();
    const fallbackEvents: GraphNode[] = [];
    for (const node of eventNodes) {
      const anchorId = anchorForEvent(node);
      if (anchorId !== undefined && result.has(anchorId)) {
        anchoredEvents.set(anchorId, [...(anchoredEvents.get(anchorId) ?? []), node]);
      } else {
        fallbackEvents.push(node);
      }
    }

    const structuralSequence = structuralNodes.slice().sort((a, b) => {
      const row = (result.get(a.id) ?? 0) - (result.get(b.id) ?? 0);
      return row || compareNodes(a, b);
    });
    let cumulativeShift = 0;
    for (const structuralNode of structuralSequence) {
      const baseRow = result.get(structuralNode.id) ?? 0;
      const eventsForAnchor = anchoredEvents.get(structuralNode.id) ?? [];
      const shiftedRow = baseRow + cumulativeShift;
      eventsForAnchor.forEach((event, index) => result.set(event.id, shiftedRow + index));
      result.set(structuralNode.id, shiftedRow + eventsForAnchor.length);
      cumulativeShift += eventsForAnchor.length;
    }

    const maxRow = Math.max(-1, ...result.values());
    fallbackEvents.forEach((event, index) => result.set(event.id, maxRow + index + 1));
  }
  for (const node of eventNodes.filter((candidate) => !result.has(candidate.id))) {
    const anchorId = anchorForEvent(node);
    const anchorRow = anchorId === undefined ? undefined : result.get(anchorId);
    // Keep malformed or legacy fixtures renderable without joining an event to
    // a commit row.  Normal GraphBuilder events are handled above.
    result.set(node.id, anchorRow === undefined ? Math.max(-1, ...result.values()) + 1 : Math.max(0, anchorRow - 1));
  }
  const minimumRow = Math.min(...result.values());
  if (Number.isFinite(minimumRow) && minimumRow < 0) {
    const shift = Math.ceil(-minimumRow);
    for (const [id, row] of result) result.set(id, row + shift);
  }
  const laidOut = nodes.map((node) => ({ ...node, row: result.get(node.id) ?? nextRow++ }));
  return { nodes: laidOut, rows: result };
}

export function assertRowInvariants(nodes: GraphNode[], edges: GraphEdge[]): void {
  const allRows = new Set<number>();
  const structuralRows = new Set<number>();
  const eventRows = new Set<number>();
  for (const node of nodes) {
    if (node.row === undefined) throw new Error(`Node ${node.id} has no row`);
    const isEvent = node.kind === 'fast-forward-event' || node.kind === 'history-event';
    const rows = isEvent ? eventRows : structuralRows;
    if (allRows.has(node.row)) throw new Error(`Duplicate timeline row ${node.row}`);
    allRows.add(node.row);
    if (rows.has(node.row)) throw new Error(`Duplicate row ${node.row}`);
    rows.add(node.row);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const eventAnchorById = new Map(edges
    .filter((edge) => edge.annotation === 'ref-event')
    .map((edge) => [edge.toNodeId, edge.fromNodeId]));
  for (const node of nodes.filter((candidate) => candidate.kind === 'fast-forward-event' || candidate.kind === 'history-event')) {
    const row = node.row as number;
    const anchorId = node.eventBoundaryCommitId ?? node.anchorCommitId ?? eventAnchorById.get(node.id);
    const anchor = anchorId ? byId.get(anchorId) : undefined;
    if (anchor && row >= (anchor.row as number)) throw new Error(`Ref event row invariant violated: ${node.id}`);
    if (anchor && structuralRows.has(row)) throw new Error(`Ref event row collides with structural row: ${node.id}`);
  }
  for (const edge of edges.filter((candidate) => candidate.type === 'parent')) {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (from && to && (from.row as number) >= (to.row as number)) throw new Error(`Parent row invariant violated: ${edge.id}`);
  }
}
