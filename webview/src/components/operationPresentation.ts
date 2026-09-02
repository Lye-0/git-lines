import type { HistoryRelation } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';

export type OperationOverlayKind = 'amend';

/**
 * Operation overlays have their own semantic color token. Keeping the token
 * independent from branch colors lets future overlay kinds share the same
 * presentation contract without recoloring the Git DAG.
 */
export const OPERATION_OVERLAY_ACCENT = 'var(--operation-overlay-accent)';

export function operationOverlayColor(_kind: OperationOverlayKind): string {
  return OPERATION_OVERLAY_ACCENT;
}

function shortOid(oid: string): string {
  return oid.slice(0, 8);
}

function operationRefName(relation: Pick<HistoryRelation, 'refName'>): string | undefined {
  if (!relation.refName) return undefined;
  const name = normalizeRefName(relation.refName);
  // HEAD is a state indicator, not a branch name.  Detached Amend overlays
  // therefore use the branch-less label even when Git reported HEAD as ref.
  return name && name !== 'HEAD' ? name : undefined;
}

export function operationAnnotationLabel(relation: HistoryRelation): string {
  const transition = `${shortOid(relation.sourceOid)} → ${shortOid(relation.targetOid)}`;
  const ref = operationRefName(relation);
  return ref ? `Amend · ${ref}: ${transition}` : `Amend · ${transition}`;
}

export function operationAnnotationTooltip(relation: HistoryRelation): string {
  const lines = [operationAnnotationLabel(relation), `Old hash\n${relation.sourceOid}`, `New hash\n${relation.targetOid}`];
  const ref = operationRefName(relation);
  if (ref) lines.push(`Branch / ref\n${ref}`);
  if (relation.rawReflogMessage) lines.push(`Reflog\n${relation.rawReflogMessage}`);
  if (Number.isFinite(relation.timestamp)) lines.push(`Occurred\n${new Date(relation.timestamp).toLocaleString()}`);
  return lines.join('\n');
}
