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

  it('keeps overlay annotation labels in the same content-width contract as commit rows', () => {
    const commitsOnly = { nodes: [nodeWithBadges(['main'])], historyRelations: [] };
    const withOverlay = {
      nodes: [nodeWithBadges(['main'])],
      historyRelations: [{
        id: 'history:cherry-pick:1',
        kind: 'cherry-pick' as const,
        sourceOid: 's'.repeat(40),
        targetOid: 'c'.repeat(40),
        timestamp: 1,
        evidence: 'reflog' as const,
      }],
    };
    expect(changesColumnStartForLayout(withOverlay)).toBeGreaterThanOrEqual(changesColumnStartForLayout(commitsOnly));
    expect(timelineContentWidthForLayout(withOverlay)).toBeGreaterThanOrEqual(timelineContentWidthForLayout(commitsOnly));
  });

  it('includes completed rebase annotation width in the content contract', () => {
    const commitsOnly = { nodes: [nodeWithBadges(['feature'])] };
    const withRebase = {
      nodes: [nodeWithBadges(['feature'])],
      rebaseRelations: [{
        id: 'history:rebase:1',
        kind: 'rebase' as const,
        refName: 'refs/heads/feature',
        oldOids: ['o'.repeat(40), 'p'.repeat(40), 'q'.repeat(40)],
        newOids: ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)],
        oldTipOid: 'q'.repeat(40),
        newTipOid: 'c'.repeat(40),
        timestamp: 1,
        evidence: 'reflog' as const,
      }],
    };
    expect(changesColumnStartForLayout(withRebase)).toBeGreaterThanOrEqual(changesColumnStartForLayout(commitsOnly));
    expect(timelineContentWidthForLayout(withRebase)).toBeGreaterThan(timelineContentWidthForLayout(commitsOnly));
  });
});
