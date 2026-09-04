import type { OverlayRelation } from '../../../src/model/graphModel';
import { isCherryPickGroupRelation, isRebaseRelation } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';
import type { EventDetailField } from './eventDetailPresentation';
import { operationKindLabel } from './operationPresentation';

export type OperationCommitRowKind = 'exact-mapping' | 'ordered-range';

export interface OperationCommitRow {
  kind: OperationCommitRowKind;
  index: number;
  leftLabel: string;
  leftOid: string;
  rightLabel: string;
  rightOid: string;
  /** Exact cherry-pick pairs use an arrow. Rebase ordered ranges do not. */
  connector: 'arrow' | 'none';
}

export interface OverlayCommitList {
  heading: string;
  ariaLabel: string;
  rows: OperationCommitRow[];
}

function compactHash(oid: string): string {
  return oid.slice(0, 8);
}

export function overlayCommitList(relation: OverlayRelation): OverlayCommitList | undefined {
  if (isCherryPickGroupRelation(relation) && relation.mappings.length > 0) {
    return {
      heading: 'Mappings',
      ariaLabel: 'Exact cherry-pick mappings',
      rows: relation.mappings.map((mapping, index) => ({
        kind: 'exact-mapping' as const,
        index,
        leftLabel: 'Source',
        leftOid: mapping.sourceOid,
        rightLabel: 'Target',
        rightOid: mapping.targetOid,
        connector: 'arrow',
      })),
    };
  }
  if (isRebaseRelation(relation) && relation.oldOids.length > 1 && relation.oldOids.length === relation.newOids.length) {
    return {
      heading: 'Commit order',
      ariaLabel: 'Rebase old and new commit order',
      rows: relation.oldOids.map((oldOid, index) => ({
        kind: 'ordered-range' as const,
        index,
        leftLabel: `Old #${index + 1}`,
        leftOid: oldOid,
        rightLabel: `New #${index + 1}`,
        rightOid: relation.newOids[index]!,
        connector: 'none',
      })),
    };
  }
  return undefined;
}

export function overlayDetailFields(relation: OverlayRelation): EventDetailField[] {
  if (isCherryPickGroupRelation(relation)) {
    return [
      { label: 'Operation', value: operationKindLabel(relation.kind) },
      { label: 'Branch / Ref', value: normalizeRefName(relation.refName ?? relation.targetRefName ?? ''), title: relation.refName ?? relation.targetRefName },
      { label: 'Commit count', value: String(relation.mappings.length) },
      { label: 'Evidence', value: 'Commit body -x' },
      { label: 'Source tip', value: compactHash(relation.sourceTipOid), title: relation.sourceTipOid, kind: 'hash' },
      { label: 'Target tip', value: compactHash(relation.targetTipOid), title: relation.targetTipOid, kind: 'hash' },
      { label: 'Timestamp', value: Number.isFinite(relation.timestamp) ? new Date(relation.timestamp).toLocaleString() : 'Unknown' },
      { label: 'Raw reflog message', value: relation.rawReflogMessage || 'Unavailable', title: relation.rawReflogMessage, kind: 'raw' },
    ];
  }
  return [];
}

export function overlayDetailTitle(relation: OverlayRelation): string {
  if (isCherryPickGroupRelation(relation)) {
    const ref = normalizeRefName(relation.refName ?? relation.targetRefName ?? '');
    return ref ? `Cherry-pick · ${ref}` : 'Cherry-pick';
  }
  if (isRebaseRelation(relation)) {
    const ref = normalizeRefName(relation.refName);
    return ref ? `Rebase · ${ref}` : 'Rebase';
  }
  return operationKindLabel(relation.kind);
}
