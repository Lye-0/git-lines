import type { GraphNode, OverlayRelation } from '../model/graphModel.js';
import { isRebaseRelation, isRefMovementRelation } from '../model/graphModel.js';
import type { OperationAnnotationRow } from './layoutTypes.js';

interface OperationRowCandidate {
  relationId: string;
  boundaryRow: number;
}

function isCommitNode(node: GraphNode | undefined): boolean {
  return node?.kind === 'commit' || node?.kind === 'reflog-commit';
}

export function overlayEndpoints(relation: OverlayRelation): { id: string; sourceOid: string; targetOid: string } {
  if (isRefMovementRelation(relation)) return { id: relation.id, sourceOid: relation.fromOid, targetOid: relation.toOid };
  if (isRebaseRelation(relation)) return { id: relation.id, sourceOid: relation.oldTipOid, targetOid: relation.newTipOid };
  return { id: relation.id, sourceOid: relation.sourceOid, targetOid: relation.targetOid };
}

function memberRows(oids: string[], byOid: Map<string, GraphNode>): number[] | undefined {
  const rows = oids.map((oid) => byOid.get(oid)?.row);
  if (rows.some((row) => row === undefined)) return undefined;
  return rows as number[];
}

/**
 * Vertical span that the overlay occupies for annotation placement.  Single
 * relations use the two endpoint commits.  Grouped rebase uses the facing
 * edges of the old/new member ranges so the row sits between the groups,
 * not inside either chain.
 */
function overlayRowSpan(relation: OverlayRelation, byOid: Map<string, GraphNode>): { lowerRow: number; upperRow: number } | undefined {
  if (isRebaseRelation(relation)) {
    const oldRows = memberRows(relation.oldOids, byOid);
    const newRows = memberRows(relation.newOids, byOid);
    if (!oldRows || !newRows) return undefined;
    const oldMin = Math.min(...oldRows);
    const oldMax = Math.max(...oldRows);
    const newMin = Math.min(...newRows);
    const newMax = Math.max(...newRows);
    if (newMax < oldMin) return { lowerRow: newMax, upperRow: oldMin };
    if (oldMax < newMin) return { lowerRow: oldMax, upperRow: newMin };
  }
  const endpoints = overlayEndpoints(relation);
  const source = byOid.get(endpoints.sourceOid);
  const target = byOid.get(endpoints.targetOid);
  if (!source || !target || source.row === undefined || target.row === undefined) return undefined;
  return { lowerRow: Math.min(source.row, target.row), upperRow: Math.max(source.row, target.row) };
}

/**
 * Inserts presentation-only rows between the endpoints of visible operation
 * relations.  The insertion is applied after lane assignment, so it changes
 * only vertical spacing; the commit DAG, topology, and lane claims remain
 * exactly the same.
 */
export function insertOperationAnnotationRows(nodes: GraphNode[], relations: OverlayRelation[]): { nodes: GraphNode[]; rows: OperationAnnotationRow[] } {
  const byOid = new Map(nodes.filter((node) => isCommitNode(node) && node.oid).map((node) => [node.oid as string, node]));
  const seen = new Set<string>();
  const candidates: OperationRowCandidate[] = relations.flatMap((relation) => {
    if (seen.has(relation.id)) return [];
    const spanRows = overlayRowSpan(relation, byOid);
    if (!spanRows) return [];
    seen.add(relation.id);
    const { lowerRow, upperRow } = spanRows;
    const span = upperRow - lowerRow;
    return [{
      relationId: relation.id,
      // Put the row in the middle of the displayed relation.  Adjacent
      // endpoints receive the first row before the lower timeline node.
      boundaryRow: lowerRow + Math.max(1, Math.ceil(span / 2)),
    }];
  }).sort((a, b) => a.boundaryRow - b.boundaryRow || a.relationId.localeCompare(b.relationId));

  const rows = candidates.map((candidate, index) => ({
    id: `operation-annotation:${candidate.relationId}`,
    relationId: candidate.relationId,
    row: candidate.boundaryRow + candidates.slice(0, index).filter((previous) => previous.boundaryRow <= candidate.boundaryRow).length,
  }));
  const shiftForNode = (row: number): number => candidates.filter((candidate) => candidate.boundaryRow <= row).length;
  return {
    nodes: nodes.map((node) => node.row === undefined ? node : { ...node, row: node.row + shiftForNode(node.row) }),
    rows,
  };
}
