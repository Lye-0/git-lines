import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../src/model/graphModel';
import { isSelectedCommit, isUnsyncedCommit, unsyncedGradientForNode } from '../../webview/src/components/nodePresentation';

const oid = (letter: string) => letter.repeat(40);

function commit(syncState: GraphNode['syncState'] = 'shared'): GraphNode {
  return { id: `commit:${oid('a')}`, kind: 'commit', oid: oid('a'), refIds: [], row: 0, lane: 0, subject: 'commit', syncState, trackId: 'main' };
}

describe('unsynchronized node presentation', () => {
  it.each(['local-only', 'remote-only'] as const)('creates a fixed diagonal gradient for %s commits', (syncState) => {
    const gradient = unsyncedGradientForNode(commit(syncState), '#2563eb', 'node-sync-gradient-test');
    expect(gradient).toMatchObject({ x1: '0%', y1: '100%', x2: '100%', y2: '0%', color: '#2563eb' });
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
