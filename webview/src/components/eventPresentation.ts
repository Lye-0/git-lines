import type { GraphNode } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';

export function isRefEvent(node: GraphNode): boolean {
  return node.kind === 'fast-forward-event' || node.kind === 'history-event';
}

function eventTypeLabel(node: GraphNode): string {
  switch (node.event?.type) {
    case 'fast-forward': return 'Fast-forward';
    case 'force-update': return 'Force update';
    case 'branch-move': return 'Branch move';
    case 'generic-ref-move': return 'Ref move';
    case 'reset': return 'Reset';
    case 'rebase': return 'Rebase';
    case 'amend': return 'Amend';
    case 'cherry-pick': return 'Cherry-pick';
    case 'revert': return 'Revert';
    default: return 'Ref event';
  }
}

function fastForwardCountLabel(node: GraphNode): string | undefined {
  const count = node.event?.commitCount;
  if (node.event?.type !== 'fast-forward' || !Number.isInteger(count) || (count as number) < 1) return undefined;
  return `+${count} ${(count as number) === 1 ? 'commit' : 'commits'}`;
}

function knownOperation(node: GraphNode): 'pull' | 'merge' | undefined {
  const operation = node.event?.operation?.toLowerCase();
  return operation === 'pull' || operation === 'merge' ? operation : undefined;
}

/** Main timeline label. Raw reflog data is kept for the tooltip below. */
export function eventMainLabel(node: GraphNode): string {
  const movement = eventMovementLabel(node);
  if (movement) return movement;
  if (node.event?.type !== 'fast-forward') return node.label ?? node.subject ?? 'Ref event';
  const parts = ['FF'];
  const count = fastForwardCountLabel(node);
  if (count) parts.push(count);
  const operation = knownOperation(node);
  if (operation) parts.push(operation);
  return parts.join(' · ');
}

function compactEventKind(node: GraphNode): string {
  switch (node.event?.type) {
    case 'fast-forward': return 'FF';
    case 'force-update': return 'Force';
    case 'branch-move': return 'Move';
    case 'generic-ref-move': return 'Move';
    case 'reset': return 'Reset';
    case 'rebase': return 'Rebase';
    case 'amend': return 'Amend';
    case 'cherry-pick': return 'Cherry-pick';
    case 'revert': return 'Revert';
    default: return 'Event';
  }
}

/** Shows the ref movement without expanding the event row's height. */
export function eventMovementLabel(node: GraphNode): string | undefined {
  const event = node.event;
  if (!event || !['reset', 'amend', 'rebase', 'cherry-pick', 'revert'].includes(event.type)) return undefined;
  if (event.type === 'cherry-pick') {
    const created = shortOid(event.toOid);
    if (!created) return 'Cherry-pick';
    const source = shortOid(event.sourceOid);
    return 'Cherry-pick · ' + (source ? source + ' ' : '') + '→ new ' + created;
  }
  if (event.type === 'revert') {
    const target = shortOid(event.targetOid);
    return target ? 'Revert · ' + target : 'Revert';
  }
  const branch = normalizeRefName(node.targetRef ?? event.refName);
  const from = shortOid(event.fromOid);
  const to = shortOid(event.toOid);
  if (!branch || !from || !to) return undefined;
  return `${compactEventKind(node)} · ${branch}: ${from} → ${to}`;
}

function textUnits(value: string): number {
  return [...value].reduce((units, character) => units + (character.charCodeAt(0) > 0x7f ? 1.6 : 1), 0);
}

/** Responsive label selection that never changes the graph/content boundary. */
export function eventLabelForWidth(node: GraphNode, width: number, x: number): string {
  const available = Math.max(14, width - x - 16);
  const maxChars = Math.max(2, Math.floor(available / 7));
  const full = eventMainLabel(node);
  const count = fastForwardCountLabel(node);
  const candidates = node.event?.type === 'fast-forward'
    ? [full, count ? `FF · ${count.split(' ')[0]}` : 'FF', 'FF']
    : [full, compactEventKind(node)];
  for (const candidate of candidates) {
    if (textUnits(candidate) <= maxChars) return candidate;
  }
  const compact = candidates[candidates.length - 1] ?? 'Event';
  return compact.slice(0, Math.max(1, maxChars - 1)) + (maxChars > 1 ? '…' : '');
}

export interface EventLabelPart {
  text: string;
  className?: string;
}

/** Splits semantic event text so target hashes can receive their visual affordance. */
export function eventLabelParts(node: GraphNode, renderedLabel: string): EventLabelPart[] {
  const target = shortOid(node.event?.targetOid);
  const fullLabel = target ? 'Revert · ' + target : undefined;
  if (node.event?.type !== 'revert' || !target || renderedLabel !== fullLabel) return [{ text: renderedLabel }];
  return [
    { text: 'Revert · ' },
    { text: target, className: 'event-revert-target' },
  ];
}

function shortOid(oid: string | undefined): string | undefined {
  return oid ? oid.slice(0, 8) : undefined;
}

function relativeTime(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  const delta = Date.now() - timestamp;
  const future = delta < 0;
  const seconds = Math.max(1, Math.round(Math.abs(delta) / 1000));
  if (seconds < 60) return future ? `in ${seconds}s` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days} day${days === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Full hover text for a ref event; raw reflog data never enters the main row. */
export function eventTooltip(node: GraphNode): string {
  const event = node.event;
  if (!event) return node.label ?? node.subject ?? 'Ref event';
  const lines = [eventTypeLabel(node)];
  const branch = normalizeRefName(node.targetRef ?? event.refName);
  if (branch) lines.push(`Branch\n${branch}`);
  const from = shortOid(event.fromOid);
  const to = shortOid(event.toOid);
  if (from && to) lines.push(`Moved\n${from} → ${to}`);
  if (event.type === 'cherry-pick') lines.push('Source\n' + (event.sourceOid ?? 'Unknown'));
  if (event.type === 'revert') lines.push('Target\n' + (event.targetOid ?? 'Unknown'));
  if (event.type === 'cherry-pick' || event.type === 'revert') {
    if (event.fromOid) lines.push('Before\n' + event.fromOid);
    if (event.toOid) lines.push('Created\n' + event.toOid);
  }
  if (event.type === 'fast-forward' && Number.isInteger(event.commitCount) && (event.commitCount as number) >= 1) {
    lines.push(`Commits\n+${event.commitCount}`);
  }
  const operation = knownOperation(node);
  if (operation) lines.push(`Operation\n${operation}`);
  const affectedRefs = [...new Set((event.affectedRefs?.length ? event.affectedRefs : [event.refName]).map(normalizeRefName))];
  if (affectedRefs.length > 1) lines.push(`Affected refs\n${affectedRefs.join('\n')}`);
  const raw = event.rawReflogMessage ?? event.subject;
  if (raw) lines.push(`Reflog\n${raw}`);
  if (Number.isFinite(event.timestamp)) {
    lines.push(`Occurred\n${new Date(event.timestamp).toLocaleString()}`);
    const relative = relativeTime(event.timestamp);
    if (relative) lines.push(relative);
  }
  return lines.join('\n');
}
