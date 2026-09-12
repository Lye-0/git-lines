import { describe, expect, it } from 'vitest';
import { commitRowPresentation, commitRowsForDisplay } from '../../webview/src/components/commitRowPresentation';
import type { GraphNode } from '../../src/model/graphModel';

describe('commit row presentation', () => {
  it('shows one unread-history notice while preserving DAG data and shallow notices', () => {
    const boundaries: GraphNode[] = ['a', 'b', 'c'].map((oid, index) => ({ id: `boundary:${oid}`, oid, kind: 'history-boundary', refIds: [], row: index + 1, label: 'More history' }));
    const commit: GraphNode = { id: 'commit:head', kind: 'commit', oid: 'head', refIds: [], row: 0 };
    const shallow: GraphNode = { id: 'shallow:head', kind: 'history-boundary', refIds: [], row: 4, label: 'Shallow history boundary' };
    const nodes = [boundaries[2], shallow, commit, boundaries[1], boundaries[0]];
    const before = structuredClone(nodes);
    expect(commitRowsForDisplay(nodes)).toEqual([commit, boundaries[0], shallow]);
    expect(nodes).toEqual(before);
    expect(commitRowsForDisplay([commit, boundaries[2]])).toEqual([commit, boundaries[2]]);
    expect(commitRowsForDisplay([commit])).toEqual([commit]);
  });
  it('marks only reset/amend previous-route commits as PREVIOUS without moving their metadata column', () => {
    const previous = commitRowPresentation({ kind: 'reflog-commit', previousRoute: true });
    const otherReflog = commitRowPresentation({ kind: 'reflog-commit', previousRoute: false });
    const current = commitRowPresentation({ kind: 'commit' });

    expect(previous).toEqual({
      previousRoute: true,
      previousBadgeLabel: 'PREVIOUS',
      metadataPlacement: 'content-start',
    });
    expect(otherReflog).toEqual({
      previousRoute: false,
      previousBadgeLabel: undefined,
      metadataPlacement: 'content-start',
    });
    expect(current).toEqual({
      previousRoute: false,
      previousBadgeLabel: undefined,
      metadataPlacement: 'content-start',
    });
  });

  it('shows a deleted/unreferenced badge only on a historical route head', () => {
    expect(commitRowPresentation({ kind: 'reflog-commit', previousRoute: false, historicalKind: 'unreferenced', historicalRouteHead: true })).toMatchObject({
      historicalBadgeLabel: 'UNREFERENCED',
    });
    expect(commitRowPresentation({ kind: 'reflog-commit', previousRoute: false, historicalKind: 'unreferenced', historicalRouteHead: false }).historicalBadgeLabel).toBeUndefined();
    expect(commitRowPresentation({ kind: 'reflog-commit', previousRoute: false, historicalKind: 'deleted-branch', historicalRouteHead: true }).historicalBadgeLabel).toBe('DELETED BRANCH');
  });
});
