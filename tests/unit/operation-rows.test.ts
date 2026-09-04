import { describe, expect, it } from 'vitest';
import type { GraphNode, HistoryRelation } from '../../src/model/graphModel.js';
import { insertOperationAnnotationRows } from '../../src/layout/operationRows.js';

const oid = (letter: string) => letter.repeat(40);

function commit(id: string, row: number, lane: number): GraphNode {
  return { id: `commit:${id}`, kind: 'commit', oid: oid(id), refIds: [], row, lane, subject: id };
}

function relation(id: string, sourceOid: string, targetOid: string, kind: HistoryRelation['kind'] = 'amend'): HistoryRelation {
  return { id, kind, sourceOid, targetOid, timestamp: 1, evidence: 'reflog' };
}

describe('operation annotation rows', () => {
  it('reserves one presentation row between a complete relation pair', () => {
    const newCommit = commit('n', 0, 0);
    const oldCommit = commit('o', 1, 1);
    const parent = commit('p', 2, 0);
    const result = insertOperationAnnotationRows(
      [newCommit, oldCommit, parent],
      [relation('amend:one', oldCommit.oid!, newCommit.oid!)],
    );

    expect(result.rows).toEqual([{ id: 'operation-annotation:amend:one', relationId: 'amend:one', row: 1 }]);
    expect(result.nodes.map((node) => [node.id, node.row])).toEqual([
      [newCommit.id, 0],
      [oldCommit.id, 2],
      [parent.id, 3],
    ]);
    expect(result.nodes.map((node) => [node.id, node.lane])).toEqual([
      [newCommit.id, 0],
      [oldCommit.id, 1],
      [parent.id, 0],
    ]);
  });

  it('creates at most one row per visible relation and ignores incomplete endpoints', () => {
    const target = commit('n', 0, 0);
    const source = commit('o', 2, 1);
    const result = insertOperationAnnotationRows(
      [target, source],
      [
        relation('amend:one', source.oid!, target.oid!),
        relation('amend:one', source.oid!, target.oid!),
        relation('amend:missing', oid('x'), target.oid!),
      ],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.relationId).toBe('amend:one');
    expect(result.nodes.find((node) => node.id === target.id)?.row).toBe(0);
    expect(result.nodes.find((node) => node.id === source.id)?.row).toBe(3);
  });

  it('keeps independent rows for mixed overlay kinds that share the graph', () => {
    const cherryNew = commit('c', 0, 0);
    const cherrySource = commit('s', 2, 1);
    const revertNew = commit('r', 3, 0);
    const revertTarget = commit('t', 5, 0);
    const result = insertOperationAnnotationRows(
      [cherryNew, cherrySource, revertNew, revertTarget],
      [
        relation('cherry:one', cherrySource.oid!, cherryNew.oid!, 'cherry-pick'),
        relation('revert:one', revertTarget.oid!, revertNew.oid!, 'revert'),
      ],
    );

    expect(result.rows).toEqual([
      { id: 'operation-annotation:cherry:one', relationId: 'cherry:one', row: 1 },
      { id: 'operation-annotation:revert:one', relationId: 'revert:one', row: 5 },
    ]);
  });

  it('does not reserve a Rebase annotation row when a group member is missing', () => {
    const newest = commit('c2', 0, 0);
    const oldest = commit('c', 4, 1);
    const result = insertOperationAnnotationRows(
      [newest, oldest],
      [{
        id: 'rebase:one',
        kind: 'rebase',
        refName: 'refs/heads/feature',
        oldOids: [oid('a'), oid('c')],
        newOids: [oid('a2'), oid('c2')],
        oldTipOid: oid('c'),
        newTipOid: oid('c2'),
        timestamp: 1,
        evidence: 'reflog',
      }],
    );
    expect(result.rows).toEqual([]);
    expect(result.nodes.map((node) => node.row)).toEqual([0, 4]);
  });

  it('places a single rebase annotation on the same span as a two-commit relation', () => {
    const newer = commit('n', 0, 0);
    const older = commit('o', 4, 1);
    const rebase = {
      id: 'rebase:one',
      kind: 'rebase' as const,
      refName: 'refs/heads/feature',
      oldOids: [older.oid!],
      newOids: [newer.oid!],
      oldTipOid: older.oid!,
      newTipOid: newer.oid!,
      timestamp: 1,
      evidence: 'reflog' as const,
    };
    const rebaseRows = insertOperationAnnotationRows([newer, older], [rebase]);
    const amendRows = insertOperationAnnotationRows([newer, older], [relation('amend:one', older.oid!, newer.oid!)]);
    expect(rebaseRows.rows[0]?.row).toBe(amendRows.rows[0]?.row);
    expect(rebaseRows.nodes.map((node) => node.row)).toEqual(amendRows.nodes.map((node) => node.row));
  });

  it('places a multi rebase annotation between the old and new groups, not inside either', () => {
    const nodes = [
      commit('3', 0, 0),
      commit('2', 1, 0),
      commit('1', 2, 0),
      commit('9', 3, 0),
      commit('e', 4, 1),
      commit('d', 5, 1),
      commit('c', 6, 1),
      commit('f', 7, 2),
    ];
    const rebase = {
      id: 'rebase:multi',
      kind: 'rebase' as const,
      refName: 'refs/heads/feature',
      oldOids: [oid('c'), oid('d'), oid('e')],
      newOids: [oid('1'), oid('2'), oid('3')],
      oldTipOid: oid('e'),
      newTipOid: oid('3'),
      timestamp: 2,
      evidence: 'reflog' as const,
    };
    const amend = relation('amend:one', oid('f'), oid('e'));
    const result = insertOperationAnnotationRows(nodes, [rebase, amend]);
    const rebaseRow = result.rows.find((row) => row.relationId === 'rebase:multi')!;
    const amendRow = result.rows.find((row) => row.relationId === 'amend:one')!;
    const newRows = ['1', '2', '3'].map((id) => result.nodes.find((node) => node.oid === oid(id))!.row!);
    const oldRows = ['c', 'd', 'e'].map((id) => result.nodes.find((node) => node.oid === oid(id))!.row!);
    const ontoRow = result.nodes.find((node) => node.oid === oid('9'))!.row!;
    const amendSourceRow = result.nodes.find((node) => node.oid === oid('f'))!.row!;
    const amendTargetRow = result.nodes.find((node) => node.oid === oid('e'))!.row!;
    expect(rebaseRow.row).toBeGreaterThan(Math.max(...newRows));
    expect(rebaseRow.row).toBeLessThan(Math.min(...oldRows));
    expect(newRows).not.toContain(rebaseRow.row);
    expect(oldRows).not.toContain(rebaseRow.row);
    expect(ontoRow).toBeGreaterThan(rebaseRow.row);
    expect(amendRow.row).toBeGreaterThanOrEqual(Math.min(amendSourceRow, amendTargetRow));
    expect(amendRow.row).toBeLessThanOrEqual(Math.max(amendSourceRow, amendTargetRow));
    expect(amendRow.row).not.toBe(rebaseRow.row);
  });
});
