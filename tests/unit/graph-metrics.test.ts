import { describe, expect, it } from 'vitest';
import { changesColumnStartForLayout, timelineContentWidthForLayout } from '../../webview/src/components/graphMetrics';
import type { GraphNode } from '../../src/model/graphModel';

const nodeWithBadges = (names: string[]): GraphNode => ({
  id: 'commit:many-refs',
  kind: 'commit',
  oid: 'a'.repeat(40),
  refIds: names,
  subject: 'Commit with many refs',
  refBadges: names.map((name) => ({ fullName: `refs/heads/${name}`, name, kind: 'local' as const })),
});

describe('graph metrics', () => {
  it('reserves horizontal space for many full-width ref badges', () => {
    const oneRef = { nodes: [nodeWithBadges(['feature'])] };
    const manyRefs = { nodes: [nodeWithBadges(Array.from({ length: 24 }, (_, index) => `ref-branch-${index + 1}`))] };
    const oneRefStart = changesColumnStartForLayout(oneRef);
    const manyRefsStart = changesColumnStartForLayout(manyRefs);
    expect(manyRefsStart).toBeGreaterThan(oneRefStart);
    expect(manyRefsStart).toBeGreaterThan(1180);
    expect(timelineContentWidthForLayout(manyRefs)).toBeGreaterThan(timelineContentWidthForLayout(oneRef));
  });
});
