import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { branchColor } from '../../src/utils/color.js';
import type { HistoryRelation } from '../../src/model/graphModel.js';
import { OPERATION_OVERLAY_ACCENT, operationAnnotationLabel, operationAnnotationParts, operationKindLabel, operationOverlayColor, operationRelationMarker } from '../../webview/src/components/operationPresentation';

const styles = readFileSync(resolve(process.cwd(), 'webview/src/styles.css'), 'utf8');

describe('operation overlay presentation', () => {
  const amend: HistoryRelation = {
    id: 'amend:one',
    kind: 'amend',
    sourceOid: '3d285090' + '0'.repeat(32),
    targetOid: 'ca53af21' + '0'.repeat(32),
    refName: 'refs/heads/main',
    timestamp: 1,
    evidence: 'reflog',
  };

  it('uses a dedicated accent instead of either endpoint branch color', () => {
    expect(operationOverlayColor('amend')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationOverlayColor('cherry-pick')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationOverlayColor('revert')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationOverlayColor('amend')).toBe('var(--operation-overlay-accent)');
    expect(operationOverlayColor('amend')).not.toBe(branchColor('main'));
    expect(operationOverlayColor('amend')).not.toBe(branchColor('feature'));
    expect(operationRelationMarker('amend')).toBe('arrow');
    expect(operationRelationMarker('cherry-pick')).toBe('arrow');
    expect(operationRelationMarker('revert')).toBe('source-cross');
    expect(operationOverlayColor('reset')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationOverlayColor('branch-move')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationOverlayColor('rebase')).toBe(OPERATION_OVERLAY_ACCENT);
    expect(operationRelationMarker('reset')).toBe('arrow');
    expect(operationRelationMarker('branch-move')).toBe('arrow');
    expect(operationRelationMarker('rebase')).toBe('arrow');
  });

  it('applies the same accent to the relation line, arrowhead, diamond, and label', () => {
    expect(styles).toContain('--operation-overlay-accent: hsl(282 84% 76%);');
    expect(styles).toContain('.history-relation-lines, .history-relation-annotation { color: var(--operation-overlay-accent); }');
    expect(styles).toContain('.history-relation-path { fill: none; stroke: currentColor;');
    expect(styles).toContain('.history-relation-arrow { fill: currentColor; stroke: none;');
    expect(styles).toContain('.history-relation-cross { fill: none; stroke: currentColor;');
    expect(styles).toContain('.history-relation-diamond { fill: var(--graph-bg); stroke: currentColor;');
    expect(styles).toContain('.history-relation-label { fill: currentColor;');
  });

  it('leaves the normal DAG edge contract separate from the overlay style', () => {
    expect(styles).toContain('.edge { fill: none; stroke-width: 2;');
    expect(styles).toContain('.edge-history-event.edge-ref-annotation { stroke-dasharray: none;');
    expect(styles).not.toContain('.edge { color: var(--operation-overlay-accent);');
  });

  it('renders the annotation row label with the operation transition', () => {
    expect(operationKindLabel('amend')).toBe('Amend');
    expect(operationKindLabel('cherry-pick')).toBe('Cherry-pick');
    expect(operationKindLabel('revert')).toBe('Revert');
    expect(operationKindLabel('reset')).toBe('Reset');
    expect(operationKindLabel('branch-move')).toBe('Branch move');
    expect(operationKindLabel('cherry-pick-group')).toBe('Cherry-pick');
    expect(operationAnnotationLabel({
      id: 'cherry-group',
      kind: 'cherry-pick-group',
      mappings: [
        { sourceOid: amend.sourceOid, targetOid: amend.targetOid },
        { sourceOid: 'b'.repeat(40), targetOid: 'd'.repeat(40) },
        { sourceOid: 'c'.repeat(40), targetOid: 'e'.repeat(40) },
      ],
      sourceOids: [amend.sourceOid, 'b'.repeat(40), 'c'.repeat(40)],
      targetOids: [amend.targetOid, 'd'.repeat(40), 'e'.repeat(40)],
      sourceTipOid: 'c'.repeat(40),
      targetTipOid: 'e'.repeat(40),
      timestamp: 1,
      evidence: 'commit-body',
    })).toBe('Cherry-pick · 3 commits · cccccccc → eeeeeeee');
    expect(operationAnnotationLabel({
      id: 'reset:one',
      kind: 'reset',
      refName: 'refs/heads/main',
      fromOid: '3a5fd462' + '0'.repeat(32),
      toOid: '1250fde5' + '0'.repeat(32),
      timestamp: 1,
      evidence: 'reflog',
      removedCommitCount: 2,
      removedRangeStartOid: 'd873771c' + '0'.repeat(32),
      removedRangeEndOid: '3a5fd462' + '0'.repeat(32),
    })).toBe('Reset · main: d873771c … 3a5fd462 (2 commits) → 1250fde5');
    expect(operationAnnotationLabel({
      id: 'move:one',
      kind: 'branch-move',
      refName: 'refs/heads/main',
      fromOid: amend.sourceOid,
      toOid: amend.targetOid,
      timestamp: 1,
      evidence: 'reflog',
    })).toBe('Branch move · main: 3d285090 → ca53af21');
    expect(operationAnnotationLabel(amend)).toBe('Amend · main: 3d285090 → ca53af21');
    expect(operationAnnotationLabel({ ...amend, refName: 'HEAD' })).toBe('Amend · 3d285090 → ca53af21');
    expect(operationAnnotationLabel({ ...amend, kind: 'cherry-pick', refName: 'refs/heads/main' })).toBe('Cherry-pick · 3d285090 → ca53af21');
    expect(operationAnnotationLabel({ ...amend, kind: 'revert', refName: 'refs/heads/main' })).toBe('Revert · 3d285090 → ca53af21');
    expect(operationAnnotationLabel({
      id: 'rebase:one',
      kind: 'rebase',
      refName: 'refs/heads/feature',
      oldOids: [amend.sourceOid],
      newOids: [amend.targetOid],
      oldTipOid: amend.sourceOid,
      newTipOid: amend.targetOid,
      timestamp: 1,
      evidence: 'reflog',
    })).toBe('Rebase · feature: 3d285090 → ca53af21');
    expect(operationAnnotationLabel({
      id: 'rebase:multi',
      kind: 'rebase',
      refName: 'refs/heads/feature',
      oldOids: [amend.sourceOid, amend.targetOid, 'c'.repeat(40)],
      newOids: ['d'.repeat(40), 'e'.repeat(40), 'f'.repeat(40)],
      oldTipOid: 'c'.repeat(40),
      newTipOid: 'f'.repeat(40),
      timestamp: 1,
      evidence: 'reflog',
    })).toBe('Rebase · feature: 3 commits · cccccccc → ffffffff');
    expect(styles).toContain('.rebase-group-outline {');
    expect(styles).toContain('stroke: var(--operation-overlay-accent);');
    expect(operationAnnotationParts({ ...amend, kind: 'revert' })).toEqual([
      { text: 'Revert · ' },
      { text: '3d285090', className: 'event-revert-target' },
      { text: ' → ca53af21' },
    ]);
    expect(styles).toContain('.operation-annotation-detail');
    expect(styles).toContain('text-overflow: ellipsis;');
    expect(styles).toContain('.event-revert-target { text-decoration: line-through;');
  });
});
