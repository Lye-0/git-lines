import { describe, expect, it } from 'vitest';
import { overlayCommitList, overlayDetailFields } from '../../webview/src/components/overlayDetailPresentation';
import type { CherryPickGroupRelation, RebaseRelation } from '../../src/model/graphModel.js';

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
});
