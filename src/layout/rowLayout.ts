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

  // Ref events are annotations, not part of the structural topological sort.
  // Assign them afterwards so adding/toggling reflog data never changes a
  // commit's row.  Fractional slots keep each event near its destination row
  // while avoiding a vertical event edge or a duplicate row.
  const occupiedRows = new Set(result.values());
  const eventAnchorById = new Map(edges.filter((edge) => edge.annotation === 'ref-event').map((edge) => [edge.toNodeId, edge.fromNodeId]));
  let eventFallbackRow = Math.max(-1, ...result.values()) + 1;
  for (const node of nodes.filter((candidate) => !structuralIds.has(candidate.id)).sort(compareNodes)) {
    const prior = previousRows?.get(node.id) ?? node.row;
    if (prior !== undefined && !occupiedRows.has(prior)) {
      result.set(node.id, prior);
      occupiedRows.add(prior);
      continue;
    }
    const anchorId = eventAnchorById.get(node.id) ?? (node.event ? nodes.find((candidate) => candidate.oid === node.event?.toOid)?.id : undefined);
    const anchorRow = anchorId ? result.get(anchorId) : undefined;
    let candidateRow = anchorRow === undefined ? eventFallbackRow : anchorRow + 0.5;
    if (anchorRow !== undefined) {
      while (occupiedRows.has(candidateRow) && candidateRow < anchorRow + 0.95) candidateRow += 0.05;
      if (candidateRow >= anchorRow + 0.95 || occupiedRows.has(candidateRow)) candidateRow = eventFallbackRow;
    }
    while (occupiedRows.has(candidateRow)) candidateRow += 1;
    result.set(node.id, candidateRow);
    occupiedRows.add(candidateRow);
    eventFallbackRow = Math.max(eventFallbackRow, candidateRow + 1);
  }
  const laidOut = nodes.map((node) => ({ ...node, row: result.get(node.id) ?? nextRow++ }));
  return { nodes: laidOut, rows: result };
}

export function assertRowInvariants(nodes: GraphNode[], edges: GraphEdge[]): void {
  const rows = new Set<number>();
  for (const node of nodes) {
    if (node.row === undefined) throw new Error(`Node ${node.id} has no row`);
    if (rows.has(node.row)) throw new Error(`Duplicate row ${node.row}`);
    rows.add(node.row);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges.filter((candidate) => candidate.type === 'parent')) {
    const from = byId.get(edge.fromNodeId);
    const to = byId.get(edge.toNodeId);
    if (from && to && (from.row as number) >= (to.row as number)) throw new Error(`Parent row invariant violated: ${edge.id}`);
  }
}
