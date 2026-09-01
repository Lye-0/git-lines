import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../src/model/graphModel.js';
import { eventLabelForWidth, eventLabelParts, eventMainLabel, eventMovementLabel, eventTooltip } from '../../webview/src/components/eventPresentation';

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

  it('shows completed rebase movement in the single event row', () => {
    const rebase = eventNode({ id: 'history:rebase:1:b', type: 'rebase', operation: undefined });
    rebase.kind = 'history-event';
    rebase.label = 'Rebase · feature';
    rebase.targetRef = 'refs/heads/feature';
    expect(eventMovementLabel(rebase)).toBe('Rebase · feature: aaaaaaaa → bbbbbbbb');
    expect(eventMainLabel(rebase)).toBe('Rebase · feature: aaaaaaaa → bbbbbbbb');
  });

  it.each([
    ['cherry-pick', 'Cherry-pick'],
    ['revert', 'Revert'],
  ] as const)('shows %s movement in the single event row', (type, label) => {
    const operation = eventNode({
      id: `history:${type}:1:b`,
      type,
      operation: undefined,
      ...(type === 'cherry-pick' ? { sourceOid: oid('s') } : { targetOid: oid('t') }),
    });
    operation.kind = 'history-event';
    operation.label = `${label} · main`;
    expect(eventMovementLabel(operation)).toBe(type === 'cherry-pick'
      ? 'Cherry-pick · ssssssss → new bbbbbbbb'
      : 'Revert · tttttttt');
    expect(eventMainLabel(operation)).toBe(type === 'cherry-pick'
      ? 'Cherry-pick · ssssssss → new bbbbbbbb'
      : 'Revert · tttttttt');
  });

  it('uses a compact cherry-pick fallback when source evidence is unavailable', () => {
    const operation = eventNode({ id: 'history:cherry-pick:1:b', type: 'cherry-pick', operation: undefined, sourceOid: undefined });
    operation.kind = 'history-event';
    expect(eventMainLabel(operation)).toBe('Cherry-pick · → new bbbbbbbb');
  });

  it('marks an explicitly identified revert target for visual strike-through', () => {
    const operation = eventNode({ id: 'history:revert:1:b', type: 'revert', operation: undefined, targetOid: oid('t') });
    operation.kind = 'history-event';
    const label = eventMainLabel(operation);
    expect(label).toBe('Revert · tttttttt');
    expect(eventLabelParts(operation, label)).toEqual([
      { text: 'Revert · ' },
      { text: 'tttttttt', className: 'event-revert-target' },
    ]);
    expect(eventLabelParts(operation, 'Revert')).toEqual([{ text: 'Revert' }]);
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

  it('keeps full source/target and before/created hashes in the tooltip', () => {
    const source = oid('s');
    const target = oid('t');
    const cherry = eventNode({ type: 'cherry-pick', sourceOid: source });
    const revert = eventNode({ type: 'revert', targetOid: target });

    expect(eventTooltip(cherry)).toContain(`Source\n${source}`);
    expect(eventTooltip(cherry)).toContain(`Before\n${oid('a')}`);
    expect(eventTooltip(cherry)).toContain(`Created\n${oid('b')}`);
    expect(eventTooltip(revert)).toContain(`Target\n${target}`);
    expect(eventTooltip(revert)).toContain(`Before\n${oid('a')}`);
    expect(eventTooltip(revert)).toContain(`Created\n${oid('b')}`);
  });
});
