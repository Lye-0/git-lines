import type { OverlayRelation, RebaseRelation, RefMovementRelation } from '../../../src/model/graphModel';
import { isCherryPickGroupRelation, isRebaseRelation, isRefMovementRelation } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';

export type OperationOverlayKind = OverlayRelation['kind'];

export interface OperationAnnotationPart {
  text: string;
  className?: string;
}

/**
 * Operation overlays have their own semantic color token. Keeping the token
 * independent from branch colors lets overlay kinds share the same
 * presentation contract without recoloring the Git DAG.
 */
export const OPERATION_OVERLAY_ACCENT = 'var(--operation-overlay-accent)';

export function operationOverlayColor(_kind: OperationOverlayKind): string {
  return OPERATION_OVERLAY_ACCENT;
}

export function operationKindLabel(kind: OperationOverlayKind): string {
  switch (kind) {
    case 'amend': return 'Amend';
    case 'cherry-pick': return 'Cherry-pick';
    case 'revert': return 'Revert';
    case 'reset': return 'Reset';
    case 'branch-move': return 'Branch move';
    case 'rebase': return 'Rebase';
    case 'cherry-pick-group': return 'Cherry-pick';
  }
}

export type OperationRelationMarker = 'arrow' | 'source-cross';

export function operationRelationMarker(kind: OperationOverlayKind): OperationRelationMarker {
  return kind === 'revert' ? 'source-cross' : 'arrow';
}

function shortOid(oid: string): string {
  return oid.slice(0, 8);
}

function operationRefName(relation: Pick<OverlayRelation, 'refName'>): string | undefined {
  if (!relation.refName) return undefined;
  const name = normalizeRefName(relation.refName);
  // HEAD is a state indicator, not a branch name.  Detached Amend overlays
  // therefore use the branch-less label even when Git reported HEAD as ref.
  return name && name !== 'HEAD' ? name : undefined;
}

function resetRemovedRangeLabel(relation: RefMovementRelation): string | undefined {
  if (relation.kind !== 'reset' || !Number.isInteger(relation.removedCommitCount) || (relation.removedCommitCount as number) < 1) return undefined;
  const count = relation.removedCommitCount as number;
  const end = shortOid(relation.removedRangeEndOid ?? relation.fromOid);
  const start = relation.removedRangeStartOid ? shortOid(relation.removedRangeStartOid) : (count === 1 ? end : undefined);
  if (!start || !end) return undefined;
  return count === 1 ? end : `${start} … ${end} (${count} commits)`;
}

function resetOperationName(relation: RefMovementRelation): string {
  return relation.resetMode ? `Reset --${relation.resetMode}` : 'Reset';
}

function rebaseAnnotationLabel(relation: RebaseRelation, transition: string): string {
  const ref = operationRefName(relation);
  const count = relation.oldOids.length;
  const countLabel = count > 1 ? `${count} commits · ` : '';
  const name = operationKindLabel(relation.kind);
  return ref ? `${name} · ${ref}: ${countLabel}${transition}` : `${name} · ${countLabel}${transition}`;
}

function cherryPickGroupAnnotationLabel(relation: OverlayRelation & { kind: 'cherry-pick-group' }, transition: string): string {
  const count = relation.mappings.length;
  return `${operationKindLabel(relation.kind)} · ${count} commits · ${transition}`;
}

function transitionLabel(relation: OverlayRelation): string {
  if (isRefMovementRelation(relation)) {
    if (relation.kind === 'reset') return `${resetRemovedRangeLabel(relation) ?? shortOid(relation.fromOid)} → ${shortOid(relation.toOid)}`;
    return `${shortOid(relation.fromOid)} → ${shortOid(relation.toOid)}`;
  }
  if (isRebaseRelation(relation)) return `${shortOid(relation.oldTipOid)} → ${shortOid(relation.newTipOid)}`;
  if (isCherryPickGroupRelation(relation)) return `${shortOid(relation.sourceTipOid)} → ${shortOid(relation.targetTipOid)}`;
  return `${shortOid(relation.sourceOid)} → ${shortOid(relation.targetOid)}`;
}

export function operationAnnotationLabel(relation: OverlayRelation): string {
  const transition = transitionLabel(relation);
  if (isRefMovementRelation(relation)) {
    const ref = operationRefName(relation);
    const name = relation.kind === 'reset' ? resetOperationName(relation) : operationKindLabel(relation.kind);
    return ref ? `${name} · ${ref}: ${transition}` : `${name} · ${transition}`;
  }
  if (isRebaseRelation(relation)) {
    return rebaseAnnotationLabel(relation, transition);
  }
  if (isCherryPickGroupRelation(relation)) {
    return cherryPickGroupAnnotationLabel(relation, transition);
  }
  const name = operationKindLabel(relation.kind);
  if (relation.kind === 'amend') {
    const ref = operationRefName(relation);
    return ref ? `${name} · ${ref}: ${transition}` : `${name} · ${transition}`;
  }
  // Cherry-pick / Revert destination reflogs name the receiving branch, not a
  // proven source ref.  Keep the row to explicit OIDs only.
  return `${name} · ${transition}`;
}

export function operationAnnotationParts(relation: OverlayRelation): OperationAnnotationPart[] {
  if (isRefMovementRelation(relation) && relation.kind === 'reset' && resetRemovedRangeLabel(relation)) {
    const ref = operationRefName(relation);
    const name = resetOperationName(relation);
    const removed = resetRemovedRangeLabel(relation)!;
    const prefix = ref ? `${name} · ${ref}: ` : `${name} · `;
    return [
      { text: prefix },
      { text: removed, className: 'event-reset-removed' },
      { text: ` → ${shortOid(relation.toOid)}` },
    ];
  }
  if (relation.kind !== 'revert') return [{ text: operationAnnotationLabel(relation) }];
  return [
    { text: 'Revert · ' },
    { text: shortOid(relation.sourceOid), className: 'event-revert-target' },
    { text: ` → ${shortOid(relation.targetOid)}` },
  ];
}

function endpointTooltipLines(relation: OverlayRelation): string[] {
  if (isRefMovementRelation(relation)) return [`From\n${relation.fromOid}`, `To\n${relation.toOid}`];
  if (isRebaseRelation(relation)) {
    const lines = [`Old tip\n${relation.oldTipOid}`, `New tip\n${relation.newTipOid}`];
    if (relation.oldOids.length > 1) lines.push(`Commits\n${relation.oldOids.length}`);
    if (relation.ontoOid) lines.push(`Onto\n${relation.ontoOid}`);
    return lines;
  }
  if (isCherryPickGroupRelation(relation)) {
    return [
      `Source tip\n${relation.sourceTipOid}`,
      `Target tip\n${relation.targetTipOid}`,
      `Exact mappings\n${relation.mappings.length}`,
      'Evidence\nCommit body -x',
    ];
  }
  if (relation.kind === 'amend') return [`Old hash\n${relation.sourceOid}`, `New hash\n${relation.targetOid}`];
  if (relation.kind === 'cherry-pick') return [`Source\n${relation.sourceOid}`, `New hash\n${relation.targetOid}`];
  return [`Target\n${relation.sourceOid}`, `New hash\n${relation.targetOid}`];
}

export function operationAnnotationTooltip(relation: OverlayRelation): string {
  const lines = [operationAnnotationLabel(relation), ...endpointTooltipLines(relation)];
  const ref = operationRefName(relation);
  if (ref) lines.push(`Branch / ref\n${ref}`);
  if (isRefMovementRelation(relation) && relation.resetMode) lines.push(`Reset mode\n${relation.resetMode}`);
  if (relation.rawReflogMessage) lines.push(`Reflog\n${relation.rawReflogMessage}`);
  if (Number.isFinite(relation.timestamp)) lines.push(`Occurred\n${new Date(relation.timestamp).toLocaleString()}`);
  return lines.join('\n');
}
