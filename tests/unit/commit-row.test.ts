import { describe, expect, it } from 'vitest';
import { commitRowPresentation } from '../../webview/src/components/commitRowPresentation';

describe('commit row presentation', () => {
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
