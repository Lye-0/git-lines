import type { HistoryEvent } from '../../../src/git/gitTypes';
import { normalizeRefName } from '../../../src/model/refDisplay';

export interface EventDetailField {
  label: string;
  value: string;
  title?: string;
  kind?: 'hash' | 'raw';
}

function titleCase(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : 'Ref event';
}

function compactHash(oid: string | undefined): EventDetailField['value'] {
  return oid ? oid.slice(0, 12) : 'Unknown';
}

function operationLabel(event: HistoryEvent): string {
  if (event.operation?.trim()) return event.operation.trim();
  if (event.type === 'branch-rename') return 'Branch rename';
  if (event.type === 'branch-move') return 'Branch move';
  return titleCase(event.type);
}

function resetRangeField(event: HistoryEvent): EventDetailField | undefined {
  if (event.type !== 'reset' || !event.removedCommitCount || event.removedCommitCount < 1) return undefined;
  const start = event.removedRangeStartOid ?? event.removedRangeEndOid ?? event.fromOid;
  const end = event.removedRangeEndOid ?? event.fromOid;
  if (!end) return undefined;
  const value = event.removedCommitCount === 1
    ? compactHash(end)
    : `${compactHash(start)} … ${compactHash(end)} (${event.removedCommitCount} commits)`;
  const title = start && start !== end ? `${start} … ${end}` : end;
  return { label: 'Removed range', value, title, kind: 'hash' };
}

/** Fields kept out of the compact timeline row and shown when an event is selected. */
export function eventDetailFields(event: HistoryEvent): EventDetailField[] {
  const operation = operationLabel(event);
  const raw = event.rawReflogMessage ?? event.subject ?? '';
  const movementFields: EventDetailField[] = event.type === 'cherry-pick'
    ? [
      { label: 'Source', value: compactHash(event.sourceOid), title: event.sourceOid, kind: 'hash' },
      { label: 'Before', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
      { label: 'Created', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
    ]
    : event.type === 'revert'
      ? [
        { label: 'Target', value: compactHash(event.targetOid), title: event.targetOid, kind: 'hash' },
        { label: 'Before', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
        { label: 'Created', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
      ]
      : event.type === 'branch-rename'
        ? [
          { label: 'From', value: normalizeRefName(event.fromRef ?? ''), title: event.fromRef },
          { label: 'To', value: normalizeRefName(event.toRef ?? event.refName), title: event.toRef ?? event.refName },
          { label: 'Commit', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
        ]
        : event.type === 'branch-move'
          ? [
            { label: 'From', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
            { label: 'To', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
          ]
        : event.type === 'reset'
          ? [
            { label: 'From', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
            { label: 'To', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
            ...(event.removedCommitCount && event.removedCommitCount > 0 ? [{ label: 'Removed commits', value: String(event.removedCommitCount) }] : []),
            ...(resetRangeField(event) ? [resetRangeField(event)!] : []),
            ...(event.resetMode ? [{ label: 'Reset mode', value: event.resetMode }] : []),
          ]
      : [
        { label: 'Old hash', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
        { label: 'New hash', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
      ];
  return [
    { label: 'Operation', value: operation },
    { label: 'Branch / Ref', value: normalizeRefName(event.refName), title: event.refName },
    ...movementFields,
    { label: 'Timestamp', value: Number.isFinite(event.timestamp) ? new Date(event.timestamp).toLocaleString() : 'Unknown' },
    { label: 'Raw reflog message', value: raw || 'Unavailable', title: raw || undefined, kind: 'raw' },
  ];
}

export function eventDetailTitle(event: HistoryEvent): string {
  if (event.type === 'branch-rename') {
    const from = normalizeRefName(event.fromRef ?? '');
    const to = normalizeRefName(event.toRef ?? event.refName);
    return from && to ? `Branch rename · ${from} → ${to}` : 'Branch rename';
  }
  if (event.type === 'branch-move') {
    const ref = normalizeRefName(event.refName);
    return ref ? `Branch move · ${ref}` : 'Branch move';
  }
  return `${titleCase(event.type)} · ${normalizeRefName(event.refName)}`;
}
