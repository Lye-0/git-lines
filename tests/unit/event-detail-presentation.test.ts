import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '../../src/git/gitTypes.js';
import { eventDetailFields, eventDetailTitle } from '../../webview/src/components/eventDetailPresentation';

const event: HistoryEvent = {
  id: 'history:amend:10:new',
  type: 'amend',
  refName: 'refs/heads/feature',
  fromOid: 'a'.repeat(40),
  toOid: 'b'.repeat(40),
  timestamp: Date.UTC(2026, 0, 1, 0, 0, 0),
  rawReflogMessage: 'commit (amend): new feature',
};

describe('event detail presentation', () => {
  it('keeps operation, ref, old/new hashes, timestamp, and raw reflog data in detail fields', () => {
    const fields = eventDetailFields(event);
    expect(fields.map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'Old hash', 'New hash', 'Timestamp', 'Raw reflog message']);
    expect(fields.find((field) => field.label === 'Operation')?.value).toBe('Amend');
    expect(fields.find((field) => field.label === 'Branch / Ref')).toMatchObject({ value: 'feature', title: 'refs/heads/feature' });
    expect(fields.find((field) => field.label === 'Old hash')).toMatchObject({ value: 'aaaaaaaaaaaa', title: 'a'.repeat(40), kind: 'hash' });
    expect(fields.find((field) => field.label === 'New hash')).toMatchObject({ value: 'bbbbbbbbbbbb', title: 'b'.repeat(40), kind: 'hash' });
    expect(fields.find((field) => field.label === 'Raw reflog message')).toMatchObject({ value: 'commit (amend): new feature', kind: 'raw' });
  });

  it('does not infer reset mode when the reflog subject does not provide one', () => {
    const reset: HistoryEvent = { ...event, id: 'history:reset:10:new', type: 'reset', rawReflogMessage: 'reset: moving to HEAD~2' };
    expect(eventDetailTitle(reset)).toBe('Reset · feature');
    expect(eventDetailFields(reset).find((field) => field.label === 'Operation')?.value).toBe('Reset');
    expect(eventDetailFields(reset).find((field) => field.label === 'Raw reflog message')?.value).toContain('reset: moving to HEAD~2');
  });
});
