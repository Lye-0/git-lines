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

  it('shows cherry-pick source, before, and created hashes without dropping detail data', () => {
    const cherryPick: HistoryEvent = {
      ...event,
      id: 'history:cherry-pick:10:new',
      type: 'cherry-pick',
      sourceOid: 'c'.repeat(40),
      rawReflogMessage: 'commit (cherry-pick): source change',
    };
    const fields = eventDetailFields(cherryPick);
    expect(fields.map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'Source', 'Before', 'Created', 'Timestamp', 'Raw reflog message']);
    expect(fields.find((field) => field.label === 'Source')).toMatchObject({ value: 'cccccccccccc', title: 'c'.repeat(40), kind: 'hash' });
    expect(fields.find((field) => field.label === 'Before')).toMatchObject({ value: 'aaaaaaaaaaaa', title: 'a'.repeat(40), kind: 'hash' });
    expect(fields.find((field) => field.label === 'Created')).toMatchObject({ value: 'bbbbbbbbbbbb', title: 'b'.repeat(40), kind: 'hash' });
  });

  it('shows a revert target when Git recorded one and keeps an explicit Unknown fallback', () => {
    const revert: HistoryEvent = {
      ...event,
      id: 'history:revert:10:new',
      type: 'revert',
      targetOid: 'd'.repeat(40),
      rawReflogMessage: 'commit: Revert "target"',
    };
    const fields = eventDetailFields(revert);
    expect(fields.map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'Target', 'Before', 'Created', 'Timestamp', 'Raw reflog message']);
    expect(fields.find((field) => field.label === 'Target')).toMatchObject({ value: 'dddddddddddd', title: 'd'.repeat(40), kind: 'hash' });

    const missingTarget = eventDetailFields({ ...revert, targetOid: undefined });
    expect(missingTarget.find((field) => field.label === 'Target')?.value).toBe('Unknown');
  });

  it('shows branch rename refs and the commit retained by the ref rename', () => {
    const rename: HistoryEvent = {
      id: 'history:branch-rename:10:new',
      type: 'branch-rename',
      refName: 'refs/heads/feature-renamed',
      toOid: 'b'.repeat(40),
      fromRef: 'refs/heads/feature',
      toRef: 'refs/heads/feature-renamed',
      operation: 'Branch rename',
      timestamp: Date.UTC(2026, 0, 1, 0, 0, 0),
      rawReflogMessage: 'Branch: renamed refs/heads/feature to refs/heads/feature-renamed',
    };
    const fields = eventDetailFields(rename);
    expect(fields.map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'From', 'To', 'Commit', 'Timestamp', 'Raw reflog message']);
    expect(fields.find((field) => field.label === 'Operation')?.value).toBe('Branch rename');
    expect(fields.find((field) => field.label === 'From')).toMatchObject({ value: 'feature', title: 'refs/heads/feature' });
    expect(fields.find((field) => field.label === 'To')).toMatchObject({ value: 'feature-renamed', title: 'refs/heads/feature-renamed' });
    expect(fields.find((field) => field.label === 'Commit')).toMatchObject({ value: 'bbbbbbbbbbbb', title: 'b'.repeat(40), kind: 'hash' });
    expect(eventDetailTitle(rename)).toBe('Branch rename · feature → feature-renamed');
  });

  it('does not infer reset mode when the reflog subject does not provide one', () => {
    const reset: HistoryEvent = { ...event, id: 'history:reset:10:new', type: 'reset', rawReflogMessage: 'reset: moving to HEAD~2' };
    expect(eventDetailTitle(reset)).toBe('Reset · feature');
    expect(eventDetailFields(reset).find((field) => field.label === 'Operation')?.value).toBe('Reset');
    expect(eventDetailFields(reset).find((field) => field.label === 'Raw reflog message')?.value).toContain('reset: moving to HEAD~2');
  });

  it('shows branch-move endpoints and a proven reset removal range in detail', () => {
    const move: HistoryEvent = {
      ...event,
      id: 'history:branch-move:10:new',
      type: 'branch-move',
      rawReflogMessage: 'branch: move to new',
    };
    expect(eventDetailFields(move).map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'From', 'To', 'Timestamp', 'Raw reflog message']);
    expect(eventDetailFields(move).find((field) => field.label === 'Operation')?.value).toBe('Branch move');

    const reset: HistoryEvent = {
      ...event,
      id: 'history:reset:10:new',
      type: 'reset',
      fromOid: 'd'.repeat(40),
      toOid: 'a'.repeat(40),
      removedCommitCount: 3,
      removedRangeStartOid: 'b'.repeat(40),
      removedRangeEndOid: 'd'.repeat(40),
      rawReflogMessage: 'reset: moving to a',
    };
    const fields = eventDetailFields(reset);
    expect(fields.map((field) => field.label)).toEqual(['Operation', 'Branch / Ref', 'From', 'To', 'Removed commits', 'Removed range', 'Timestamp', 'Raw reflog message']);
    expect(fields.find((field) => field.label === 'Removed commits')?.value).toBe('3');
    expect(fields.find((field) => field.label === 'Removed range')).toMatchObject({ value: 'bbbbbbbbbbbb … dddddddddddd (3 commits)', title: `${'b'.repeat(40)} … ${'d'.repeat(40)}` });
  });
});
