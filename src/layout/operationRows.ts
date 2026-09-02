import type { GraphNode, HistoryRelation } from '../model/graphModel.js';
import type { OperationAnnotationRow } from './layoutTypes.js';

interface OperationRowCandidate {
  relationId: string;
  boundaryRow: number;
}

function isCommitNode(node: GraphNode | undefined): boolean {
  return node?.kind === 'commit' || node?.kind === 'reflog-commit';
}

/**
 * Inserts presentation-only rows between the endpoints of visible operation
 * relations.  The insertion is applied after lane assignment, so it changes
 * only vertical spacing; the commit DAG, topology, and lane claims remain
 * exactly the same.
 */
export function insertOperationAnnotationRows(nodes: GraphNode[], relations: HistoryRelation[]): { nodes: GraphNode[]; rows: OperationAnnotationRow[] } {
  const byOid = new Map(nodes.filter((node) => isCommitNode(node) && node.oid).map((node) => [node.oid as string, node]));
  const seen = new Set<string>();
  const candidates: OperationRowCandidate[] = relations.flatMap((relation) => {
    if (seen.has(relation.id)) return [];
    const source = byOid.get(relation.sourceOid);
    const target = byOid.get(relation.targetOid);
    if (!source || !target || source.row === undefined || target.row === undefined) return [];
    seen.add(relation.id);
    const lowerRow = Math.min(source.row, target.row);
    const upperRow = Math.max(source.row, target.row);
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
