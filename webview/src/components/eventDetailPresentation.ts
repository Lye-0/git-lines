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

/** Fields kept out of the compact timeline row and shown when an event is selected. */
export function eventDetailFields(event: HistoryEvent): EventDetailField[] {
  const operation = event.operation?.trim() || titleCase(event.type);
  const raw = event.rawReflogMessage ?? event.subject ?? '';
  return [
    { label: 'Operation', value: operation },
    { label: 'Branch / Ref', value: normalizeRefName(event.refName), title: event.refName },
    { label: 'Old hash', value: compactHash(event.fromOid), title: event.fromOid, kind: 'hash' },
    { label: 'New hash', value: compactHash(event.toOid), title: event.toOid, kind: 'hash' },
    { label: 'Timestamp', value: Number.isFinite(event.timestamp) ? new Date(event.timestamp).toLocaleString() : 'Unknown' },
    { label: 'Raw reflog message', value: raw || 'Unavailable', title: raw || undefined, kind: 'raw' },
  ];
}

export function eventDetailTitle(event: HistoryEvent): string {
  return `${titleCase(event.type)} · ${normalizeRefName(event.refName)}`;
}
