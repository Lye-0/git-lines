import type { HistoryEvent } from '../../../src/git/gitTypes';
import type { OverlayRelation } from '../../../src/model/graphModel';
import { isCherryPickGroupRelation, isRebaseRelation, isRewriteCollapseRelation } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';
import { eventDetailFields, eventDetailTitle, type EventDetailField } from './eventDetailPresentation';
import { operationKindLabel } from './operationPresentation';

export type OperationCommitRowKind = 'exact-mapping' | 'old-commit';

export interface OperationCommitRow {
  kind: OperationCommitRowKind;
  index: number;
  leftLabel: string;
  leftOid: string;
  rightLabel: string;
  rightOid: string;
  /** Exact cherry-pick pairs use an arrow; squash/fixup old lists do not. */
  connector: 'arrow' | 'none';
}

export interface OverlayCommitList {
  heading: string;
  ariaLabel: string;
  rows: OperationCommitRow[];
}

export interface OverlayOrderedList {
  role: 'old' | 'new';
  heading: string;
  oids: string[];
}

/** Each range has its own order. No row or index associates the two ranges. */
export function overlayOrderedLists(relation: OverlayRelation): OverlayOrderedList[] {
  if (!isRebaseRelation(relation) || relation.oldOids.length <= 1) return [];
  return [
    { role: 'old', heading: 'Old order', oids: relation.oldOids },
    { role: 'new', heading: 'New order', oids: relation.newOids },
  ];
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
  if (isRewriteCollapseRelation(relation)) {
    return {
      heading: 'Old commits',
      ariaLabel: 'Squash or fixup old commits oldest to newest',
      rows: relation.oldOids.map((oldOid, index) => ({
        kind: 'old-commit' as const,
        index,
        leftLabel: `#${index + 1}`,
        leftOid: oldOid,
        rightLabel: '',
        rightOid: '',
        connector: 'none',
      })),
    };
  }
  return undefined;
}

export function overlayDetailFields(relation: OverlayRelation): EventDetailField[] {
  if (relation.kind === 'reword') {
    return [
      { label: 'Operation', value: 'Reword' },
      { label: 'Old commit', value: compactHash(relation.sourceOid), title: relation.sourceOid, kind: 'hash' },
      { label: 'New commit', value: compactHash(relation.targetOid), title: relation.targetOid, kind: 'hash' },
      { label: 'Evidence', value: 'Reflog · rebase (reword)' },
      { label: 'Timestamp', value: Number.isFinite(relation.timestamp) ? new Date(relation.timestamp).toLocaleString() : 'Unknown' },
      { label: 'Raw reflog message', value: relation.rawReflogMessage || 'Unavailable', kind: 'raw' },
    ];
  }
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
  if (isRewriteCollapseRelation(relation)) {
    return [
      { label: 'Operation', value: operationKindLabel(relation.kind) },
      { label: 'Branch / Ref', value: normalizeRefName(relation.refName), title: relation.refName },
      { label: 'New commit', value: compactHash(relation.newOid), title: relation.newOid, kind: 'hash' },
      { label: 'Rewrite', value: `${relation.oldOids.length} → 1` },
      { label: 'Evidence', value: `Reflog · rebase (${relation.kind})` },
      { label: 'Timestamp', value: Number.isFinite(relation.timestamp) ? new Date(relation.timestamp).toLocaleString() : 'Unknown' },
      { label: 'Raw reflog message', value: relation.rawReflogMessage || 'Unavailable', title: relation.rawReflogMessage, kind: 'raw' },
    ];
  }
  return [];
}

export function overlayDetailTitle(relation: OverlayRelation): string {
  if (relation.kind === 'reword') {
    const ref = normalizeRefName(relation.refName ?? '');
    return ref ? `Reword · ${ref}` : 'Reword';
  }
  if (isCherryPickGroupRelation(relation)) {
    const ref = normalizeRefName(relation.refName ?? relation.targetRefName ?? '');
    return ref ? `Cherry-pick · ${ref}` : 'Cherry-pick';
  }
  if (isRewriteCollapseRelation(relation)) {
    const ref = normalizeRefName(relation.refName);
    const name = operationKindLabel(relation.kind);
    return ref ? `${name} · ${ref}` : name;
  }
  if (isRebaseRelation(relation)) {
    const ref = normalizeRefName(relation.refName);
    return ref ? `Rebase · ${ref}` : 'Rebase';
  }
  return operationKindLabel(relation.kind);
}

/**
 * Cherry-pick groups and squash/fixup collapse own their Detail Panel.
 * Generic rebase History Events still supply Rebase fields; the overlay only
 * adds independent old/new ordered lists. Shared history-event ids must not steal collapse Detail.
 */
export function overlayOwnsOperationDetail(relation: OverlayRelation | undefined): boolean {
  return Boolean(relation && (relation.kind === 'reword' || isRewriteCollapseRelation(relation) || isCherryPickGroupRelation(relation)));
}

export function operationDetailContent(overlay?: OverlayRelation, event?: HistoryEvent): { title: string; fields: EventDetailField[]; commitList: OverlayCommitList | undefined; orderedLists: OverlayOrderedList[] } | undefined {
  const orderedLists = overlay ? overlayOrderedLists(overlay) : [];
  if (overlay && overlayOwnsOperationDetail(overlay)) {
    return { title: overlayDetailTitle(overlay), fields: overlayDetailFields(overlay), commitList: overlayCommitList(overlay), orderedLists };
  }
  if (event) {
    return { title: eventDetailTitle(event), fields: eventDetailFields(event), commitList: overlay ? overlayCommitList(overlay) : undefined, orderedLists };
  }
  if (overlay) {
    return { title: overlayDetailTitle(overlay), fields: overlayDetailFields(overlay), commitList: overlayCommitList(overlay), orderedLists };
  }
  return undefined;
}

/** Selection lookup used by the Detail Panel: overlay id and History Event id are independent. */
export function resolveSelectedOperationDetail(selectedId: string | undefined, overlays: OverlayRelation[], events: HistoryEvent[]) {
  if (!selectedId) return undefined;
  const overlay = overlays.find((relation) => relation.id === selectedId);
  const event = events.find((candidate) => candidate.id === selectedId);
  return operationDetailContent(overlay, event);
}
