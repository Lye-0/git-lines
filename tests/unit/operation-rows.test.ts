import { describe, expect, it } from 'vitest';
import type { GraphNode, HistoryRelation } from '../../src/model/graphModel.js';
import { insertOperationAnnotationRows } from '../../src/layout/operationRows.js';

const oid = (letter: string) => letter.repeat(40);

function commit(id: string, row: number, lane: number): GraphNode {
  return { id: `commit:${id}`, kind: 'commit', oid: oid(id), refIds: [], row, lane, subject: id };
}

function relation(id: string, sourceOid: string, targetOid: string): HistoryRelation {
  return { id, kind: 'amend', sourceOid, targetOid, timestamp: 1, evidence: 'reflog' };
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
});
