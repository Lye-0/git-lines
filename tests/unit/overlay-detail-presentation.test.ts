import { describe, expect, it } from 'vitest';
import { overlayCommitList, overlayDetailFields, operationDetailContent, resolveSelectedOperationDetail } from '../../webview/src/components/overlayDetailPresentation';
import type { CherryPickGroupRelation, HistoryRelation, RebaseRelation } from '../../src/model/graphModel.js';
import type { HistoryEvent } from '../../src/git/gitTypes.js';

const oid = (letter: string) => letter.repeat(40);

describe('overlay operation detail lists', () => {
  it('CP-D1 / CP-D2 lists exact cherry-pick mappings oldest to newest with Source → Target', () => {
    const relation: CherryPickGroupRelation = {
      id: 'history:cherry-pick-group:1',
      kind: 'cherry-pick-group',
      mappings: [
        { sourceOid: oid('a'), targetOid: oid('1') },
        { sourceOid: oid('b'), targetOid: oid('2') },
        { sourceOid: oid('c'), targetOid: oid('3') },
      ],
      sourceOids: [oid('a'), oid('b'), oid('c')],
      targetOids: [oid('1'), oid('2'), oid('3')],
      sourceTipOid: oid('c'),
      targetTipOid: oid('3'),
      timestamp: 1,
      evidence: 'commit-body',
    };
    const list = overlayCommitList(relation)!;
    expect(list.heading).toBe('Mappings');
    expect(list.rows).toHaveLength(3);
    expect(list.rows.map((row) => [row.leftLabel, row.leftOid, row.connector, row.rightLabel, row.rightOid])).toEqual([
      ['Source', oid('a'), 'arrow', 'Target', oid('1')],
      ['Source', oid('b'), 'arrow', 'Target', oid('2')],
      ['Source', oid('c'), 'arrow', 'Target', oid('3')],
    ]);
    expect(overlayDetailFields(relation).find((field) => field.label === 'Evidence')?.value).toBe('Commit body -x');
  });

  it('CP-D3 does not create mapping rows for non-group overlays', () => {
    expect(overlayCommitList({
      id: 'history:cherry-pick:1',
      kind: 'cherry-pick',
      sourceOid: oid('a'),
      targetOid: oid('1'),
      timestamp: 1,
      evidence: 'reflog',
    })).toBeUndefined();
  });

  it('RB-D1 / RB-D2 / RB-D3 lists rebase old/new order without exact mapping arrows', () => {
    const relation: RebaseRelation = {
      id: 'history:rebase:1',
      kind: 'rebase',
      refName: 'refs/heads/feature',
      oldOids: [oid('c'), oid('d'), oid('e')],
      newOids: [oid('1'), oid('2'), oid('3')],
      oldTipOid: oid('e'),
      newTipOid: oid('3'),
      timestamp: 1,
      evidence: 'reflog',
    };
    const list = overlayCommitList(relation)!;
    expect(list.heading).toBe('Commit order');
    expect(list.heading).not.toBe('Mappings');
    expect(list.rows.map((row) => [row.leftLabel, row.leftOid, row.connector, row.rightLabel, row.rightOid])).toEqual([
      ['Old #1', oid('c'), 'none', 'New #1', oid('1')],
      ['Old #2', oid('d'), 'none', 'New #2', oid('2')],
      ['Old #3', oid('e'), 'none', 'New #3', oid('3')],
    ]);
  });

  it('does not add a rebase commit-order table for a single rewrite', () => {
    expect(overlayCommitList({
      id: 'history:rebase:1',
      kind: 'rebase',
      refName: 'refs/heads/feature',
      oldOids: [oid('f')],
      newOids: [oid('4')],
      oldTipOid: oid('f'),
      newTipOid: oid('4'),
      timestamp: 1,
      evidence: 'reflog',
    })).toBeUndefined();
  });

  it('119 rebase overlay click keeps Rebase title, Operation Rebase, and Commit order', () => {
    const event: HistoryEvent = {
      id: 'history:rebase:20:new',
      type: 'rebase',
      refName: 'refs/heads/feature',
      fromOid: oid('e'),
      toOid: oid('3'),
      timestamp: 20,
      subject: 'rebase (finish): refs/heads/feature onto onto',
    };
    const relation: RebaseRelation = {
      id: event.id,
      kind: 'rebase',
      refName: 'refs/heads/feature',
      oldOids: [oid('c'), oid('d'), oid('e')],
      newOids: [oid('1'), oid('2'), oid('3')],
      oldTipOid: oid('e'),
      newTipOid: oid('3'),
      timestamp: 20,
      evidence: 'reflog',
    };
    const selected = resolveSelectedOperationDetail(event.id, [relation], [event])!;
    expect(selected.title).toBe('Rebase · feature');
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Rebase');
    expect(selected.commitList?.heading).toBe('Commit order');
    expect(selected.commitList?.rows).toHaveLength(3);
  });

  it('120 cherry-pick group click keeps Mappings and does not use a Rebase event', () => {
    const relation: CherryPickGroupRelation = {
      id: 'history:cherry-pick-group:1',
      kind: 'cherry-pick-group',
      mappings: [
        { sourceOid: oid('a'), targetOid: oid('1') },
        { sourceOid: oid('b'), targetOid: oid('2') },
        { sourceOid: oid('c'), targetOid: oid('3') },
      ],
      sourceOids: [oid('a'), oid('b'), oid('c')],
      targetOids: [oid('1'), oid('2'), oid('3')],
      sourceTipOid: oid('c'),
      targetTipOid: oid('3'),
      timestamp: 1,
      evidence: 'commit-body',
    };
    const rebaseEvent: HistoryEvent = {
      id: 'history:rebase:1',
      type: 'rebase',
      refName: 'refs/heads/main',
      fromOid: oid('a'),
      toOid: oid('3'),
      timestamp: 1,
      subject: 'rebase (finish)',
    };
    const selected = resolveSelectedOperationDetail(relation.id, [relation], [rebaseEvent])!;
    expect(selected.title).toBe('Cherry-pick');
    expect(selected.commitList?.heading).toBe('Mappings');
    expect(selected.commitList?.rows).toHaveLength(3);
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Cherry-pick');
  });

  it('126 individual exact cherry-pick click keeps History Event detail, not a group', () => {
    const event: HistoryEvent = {
      id: 'history:cherry-pick:8:target',
      type: 'cherry-pick',
      refName: 'refs/heads/main',
      fromOid: oid('m'),
      toOid: oid('1'),
      sourceOid: oid('a'),
      timestamp: 8,
      subject: 'cherry-pick: a',
    };
    const relation: HistoryRelation = {
      id: event.id,
      kind: 'cherry-pick',
      sourceOid: oid('a'),
      targetOid: oid('1'),
      refName: 'refs/heads/main',
      timestamp: 8,
      evidence: 'reflog',
    };
    const selected = resolveSelectedOperationDetail(event.id, [relation], [event])!;
    expect(selected.title).toBe('Cherry-pick · main');
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Cherry-pick');
    expect(selected.commitList).toBeUndefined();
  });

  it('prefers RewriteCollapse overlay detail when a same-session Rebase event is also present', () => {
    const event: HistoryEvent = {
      id: 'history:rebase:20:s',
      type: 'rebase',
      refName: 'refs/heads/feature',
      fromOid: oid('b'),
      toOid: oid('s'),
      timestamp: 20,
      subject: 'rebase (finish)',
    };
    const overlay = {
      id: 'rewrite-collapse:squash:refs/heads/feature:old:new',
      kind: 'squash' as const,
      refName: 'refs/heads/feature',
      oldOids: [oid('a'), oid('b')],
      newOid: oid('s'),
      oldTipOid: oid('b'),
      newTipOid: oid('s'),
      timestamp: 20,
      evidence: 'reflog' as const,
    };
    const mixed = operationDetailContent(overlay, event)!;
    expect(mixed.title).toBe('Squash · feature');
    expect(mixed.fields.find((field) => field.label === 'Operation')?.value).toBe('Squash');
  });
});
