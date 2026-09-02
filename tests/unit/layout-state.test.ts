import { describe, expect, it } from 'vitest';
import type { GraphLayout } from '../../src/layout/layoutTypes.js';
import type { GraphNode } from '../../src/model/graphModel.js';
import { LayoutState } from '../../src/layout/layoutState.js';

function node(id: string, row: number): GraphNode {
  return { id, kind: 'commit', oid: id.repeat(40), refIds: [], row, lane: 0 };
}

describe('LayoutState', () => {
  it('stores structural rows without virtual operation annotation gaps', () => {
    const layout: GraphLayout = {
      nodes: [node('a', 0), node('b', 2), node('c', 4)],
      edges: [],
      tracks: [],
      visibleCommitCount: 3,
      hasMore: false,
      rowHeight: 38,
      laneWidth: 34,
      operationAnnotationRows: [
        { id: 'operation-annotation:first', relationId: 'first', row: 1 },
        { id: 'operation-annotation:second', relationId: 'second', row: 3 },
      ],
    };
    const state = new LayoutState();

    state.set(layout);

    expect([...state.rows.entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});
