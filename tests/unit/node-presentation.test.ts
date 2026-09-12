import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../src/model/graphModel';
import { isLinkedWorktreeCommit, isSelectedCommit, isUnsyncedCommit, nodeFillStyle, nodeMarkGeometry, nodeRingGeometry, NODE_LOCAL_CENTER, NODE_SELECTION_RING_RADIUS, SMALL_COMMIT_NODE_RADIUS, unsyncedGradientForNode } from '../../webview/src/components/nodePresentation';
import { COMMIT_NODE_RADIUS, pointForNode } from '../../src/layout/edgeRouter.js';
import { insertOperationAnnotationRows } from '../../src/layout/operationRows.js';

const oid = (letter: string) => letter.repeat(40);

function commit(syncState: GraphNode['syncState'] = 'shared'): GraphNode {
  return { id: `commit:${oid('a')}`, kind: 'commit', oid: oid('a'), refIds: [], row: 0, lane: 0, subject: 'commit', syncState, trackId: 'main' };
}

describe('unsynchronized node presentation', () => {
  it.each(['local-only', 'remote-only'] as const)('creates a fixed diagonal gradient for %s commits', (syncState) => {
    const gradient = unsyncedGradientForNode(commit(syncState), '#2563eb', 'node-sync-gradient-test');
    expect(gradient).toMatchObject({ x1: '0%', y1: '0%', x2: '100%', y2: '100%', color: '#2563eb' });
    expect(gradient?.stops).toEqual([
      { offset: '0%', opacity: 0.32 },
      { offset: '38%', opacity: 0.32 },
      { offset: '50%', opacity: 0.62 },
      { offset: '62%', opacity: 1 },
      { offset: '100%', opacity: 1 },
    ]);
  });

  it('keeps shared commits on the ordinary solid fill', () => {
    expect(isUnsyncedCommit(commit('shared'))).toBe(false);
    expect(unsyncedGradientForNode(commit('shared'), '#2563eb', 'node-sync-gradient-shared')).toBeUndefined();
  });

  it('renders the unsynchronized fill and selected ring together', () => {
    const node = commit('local-only');
    expect(isUnsyncedCommit(node)).toBe(true);
    expect(isSelectedCommit(node, node.oid)).toBe(true);
    expect(unsyncedGradientForNode(node, '#2563eb', 'node-sync-gradient-selected')).toBeDefined();
    expect(nodeFillStyle('url(#node-sync-gradient-selected)')).toEqual({ fill: 'url(#node-sync-gradient-selected)' });
  });

  it('marks the real linked-worktree commit node for the rounded-square symbol', () => {
    const linked = { ...commit(), linkedWorktrees: [{ worktreeId: 'linked', path: 'C:/linked', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }] };
    expect(isLinkedWorktreeCommit(linked)).toBe(true);
    expect(isLinkedWorktreeCommit({ ...linked, linkedWorktrees: [] })).toBe(false);
    expect(isLinkedWorktreeCommit({ ...linked, kind: 'working-tree' })).toBe(false);
  });

  it.each([
    { kind: 'working-tree' as const, syncState: 'local-only' as const },
    { kind: 'fast-forward-event' as const, syncState: 'remote-only' as const },
    { kind: 'reflog-commit' as const, syncState: 'local-only' as const },
  ])('does not apply the commit fill to $kind nodes', ({ kind, syncState }) => {
    const node: GraphNode = { id: `${kind}:a`, kind, row: 0, lane: 0, refIds: [], trackId: 'main', syncState };
    expect(isUnsyncedCommit(node)).toBe(false);
    expect(unsyncedGradientForNode(node, '#2563eb', 'node-sync-gradient-auxiliary')).toBeUndefined();
  });
});

describe('node mark and selection ring geometry', () => {
  const previous: GraphNode = {
    id: `commit:${oid('o')}`,
    kind: 'reflog-commit',
    oid: oid('o'),
    refIds: [],
    row: 2,
    lane: 1,
    subject: 'previous',
    previousRoute: true,
    historicalKind: 'previous',
  };
  const unreferenced: GraphNode = { ...previous, id: `commit:${oid('u')}`, oid: oid('u'), historicalKind: 'unreferenced', previousRoute: false };
  const linked = {
    ...commit(),
    linkedWorktrees: [{ worktreeId: 'linked', path: 'C:/linked', detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true }],
  };

  it.each([
    { name: 'normal commit', node: commit(), radius: COMMIT_NODE_RADIUS, shape: 'dot' as const },
    { name: 'PREVIOUS', node: previous, radius: SMALL_COMMIT_NODE_RADIUS, shape: 'dot' as const },
    { name: 'UNREFERENCED', node: unreferenced, radius: SMALL_COMMIT_NODE_RADIUS, shape: 'dot' as const },
    { name: 'linked worktree', node: linked, radius: COMMIT_NODE_RADIUS, shape: 'square' as const },
  ])('shares one center between the $name mark and its selection ring', ({ node, radius, shape }) => {
    const mark = nodeMarkGeometry(node);
    const ring = nodeRingGeometry(node);
    expect(mark.center).toEqual(NODE_LOCAL_CENTER);
    expect(mark.shape).toBe(shape);
    expect(mark.radius).toBe(radius);
    expect(ring).toEqual({ cx: mark.center.x, cy: mark.center.y, r: NODE_SELECTION_RING_RADIUS });
  });

  it('keeps PREVIOUS mark and ring concentric after an OperationAnnotationRow shifts visual Y', () => {
    const live = { ...commit(), row: 0 };
    const old = { ...previous, row: 1 };
    const inserted = insertOperationAnnotationRows([live, old], [{
      id: 'amend:one',
      kind: 'amend',
      sourceOid: old.oid!,
      targetOid: live.oid!,
      timestamp: 1,
      evidence: 'reflog',
    }]);
    const shifted = inserted.nodes.find((node) => node.id === old.id)!;
    expect(shifted.row).not.toBe(old.row);
    const origin = pointForNode(shifted);
    const mark = nodeMarkGeometry(shifted);
    const ring = nodeRingGeometry(shifted);
    expect(origin.x + mark.center.x).toBe(origin.x + ring.cx);
    expect(origin.y + mark.center.y).toBe(origin.y + ring.cy);
    expect(mark.center).toEqual(NODE_LOCAL_CENTER);
  });
});
