import { describe, expect, it } from 'vitest';
import { commitMetaText } from '../../webview/src/components/commitRowPresentation';
import { routeNameForNode, routeNameForTrack } from '../../webview/src/components/routePresentation';

function track(id: string, label: string, refNames: string[]) {
  return { id, label, refNames };
}

describe('Branch / Route presentation', () => {
  it('uses the layout route and prefers its local branch over remote badges', () => {
    const tracks = [
      track('main-route', 'main · origin/main', ['refs/heads/main', 'refs/remotes/origin/main']),
      track('feature-route', 'alice/feature-04 · feature-04', ['refs/remotes/alice/feature-04', 'refs/heads/feature-04']),
    ];

    expect(routeNameForNode({ trackId: 'main-route' }, tracks)).toBe('main');
    expect(routeNameForNode({ trackId: 'feature-route' }, tracks)).toBe('feature-04');
  });

  it('resolves a route for a ref-less ancestor from its assigned track', () => {
    const tracks = [track('feature-route', 'feature-04', ['refs/heads/feature-04'])];

    expect(routeNameForNode({ trackId: 'feature-route' }, tracks)).toBe('feature-04');
  });

  it('distinguishes separate routes within one branch family', () => {
    const tracks = [
      track('feature-local-route', 'feature-04', ['refs/heads/feature-04']),
      track('feature-alice-route', 'alice/feature-04', ['refs/remotes/alice/feature-04']),
    ];

    expect(routeNameForNode({ trackId: 'feature-local-route' }, tracks)).toBe('feature-04');
    expect(routeNameForNode({ trackId: 'feature-alice-route' }, tracks)).toBe('alice/feature-04');
  });

  it('keeps the full long route name available for the tooltip while metadata stays compact', () => {
    const longRoute = 'feature/this-is-an-extremely-long-route-name-for-git-lines';

    expect(routeNameForTrack(track('long-route', longRoute, ['refs/heads/feature/this-is-an-extremely-long-route-name-for-git-lines']))).toBe(longRoute);
    expect(commitMetaText('3ee40307abcdef', longRoute, '2d ago')).toBe(`3ee40307 · ${longRoute} · 2d ago`);
  });

  it('does not include the author in list metadata', () => {
    const metadata = commitMetaText('3ee40307abcdef', 'feature-04', '608d ago');

    expect(metadata).toBe('3ee40307 · feature-04 · 608d ago');
    expect(metadata).not.toContain('Git Lines Test');
  });
});
