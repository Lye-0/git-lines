import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../src/model/graphModel.js';
import { eventLabelForWidth, eventMainLabel, eventMovementLabel, eventTooltip } from '../../webview/src/components/eventPresentation';

const oid = (letter: string) => letter.repeat(40);

function eventNode(overrides: Partial<NonNullable<GraphNode['event']>> = {}): GraphNode {
  const event = {
    id: 'history:fast-forward:1:b',
    type: 'fast-forward' as const,
    refName: 'refs/heads/main',
    fromOid: oid('a'),
    toOid: oid('b'),
    timestamp: Date.now() - 60_000,
    commitCount: 3,
    operation: 'pull',
    rawReflogMessage: 'pull origin/main: Fast-forward',
    affectedRefs: ['refs/heads/main', 'HEAD', 'refs/remotes/origin/main'],
    ...overrides,
  };
  return {
    id: event.id,
    kind: 'fast-forward-event',
    label: 'Fast-forward · main',
    refIds: [],
    trackId: 'family:main',
    targetRef: 'refs/heads/main',
    event,
  };
}

describe('ref event presentation', () => {
  it('uses the structured FF count and known operation in the main label', () => {
    expect(eventMainLabel(eventNode())).toBe('FF · +3 commits · pull');
    expect(eventMainLabel(eventNode({ commitCount: 1 }))).toBe('FF · +1 commit · pull');
    expect(eventMainLabel(eventNode({ operation: undefined }))).toBe('FF · +3 commits');
    expect(eventMainLabel(eventNode({ operation: 'fetch' }))).toBe('FF · +3 commits');
  });

  it('shows reset and amend ref movement in the single event row', () => {
    const reset = eventNode({ id: 'history:reset:1:b', type: 'reset', operation: undefined });
    reset.kind = 'history-event';
    reset.label = 'Reset · main';
    expect(eventMovementLabel(reset)).toBe('Reset · main: aaaaaaaa → bbbbbbbb');
    expect(eventMainLabel(reset)).toBe('Reset · main: aaaaaaaa → bbbbbbbb');

    const amend = eventNode({ id: 'history:amend:1:b', type: 'amend', operation: undefined });
    amend.kind = 'history-event';
    expect(eventMainLabel(amend)).toBe('Amend · main: aaaaaaaa → bbbbbbbb');
  });

  it('compacts only the event label when the graph area is narrow', () => {
    const node = eventNode();
    expect(eventLabelForWidth(node, 120, 24)).toBe('FF · +3');
    expect(eventLabelForWidth(node, 60, 24)).toBe('FF');
  });

  it('keeps raw reflog and movement details in the tooltip', () => {
    const tooltip = eventTooltip(eventNode());
    expect(tooltip).toContain('Branch\nmain');
    expect(tooltip).toContain(`Moved\naaaaaaaa → bbbbbbbb`);
    expect(tooltip).toContain('Commits\n+3');
    expect(tooltip).toContain('Operation\npull');
    expect(tooltip).toContain('Affected refs\nmain\nHEAD\norigin/main');
    expect(tooltip).toContain('Reflog\npull origin/main: Fast-forward');
    expect(tooltip).toContain('Occurred\n');
  });
});
