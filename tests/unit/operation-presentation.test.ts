import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { branchColor } from '../../src/utils/color.js';
import type { HistoryRelation } from '../../src/model/graphModel.js';
import { OPERATION_OVERLAY_ACCENT, operationAnnotationLabel, operationOverlayColor } from '../../webview/src/components/operationPresentation';

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
    expect(operationOverlayColor('amend')).toBe('var(--operation-overlay-accent)');
    expect(operationOverlayColor('amend')).not.toBe(branchColor('main'));
    expect(operationOverlayColor('amend')).not.toBe(branchColor('feature'));
  });

  it('applies the same accent to the relation line, arrowhead, diamond, and label', () => {
    expect(styles).toContain('--operation-overlay-accent: hsl(282 84% 76%);');
    expect(styles).toContain('.history-relation-lines, .history-relation-annotation { color: var(--operation-overlay-accent); }');
    expect(styles).toContain('.history-relation-path { fill: none; stroke: currentColor;');
    expect(styles).toContain('.history-relation-arrow { fill: currentColor; stroke: none;');
    expect(styles).toContain('.history-relation-diamond { fill: var(--graph-bg); stroke: currentColor;');
    expect(styles).toContain('.history-relation-label { fill: currentColor;');
  });

  it('leaves the normal DAG edge contract separate from the overlay style', () => {
    expect(styles).toContain('.edge { fill: none; stroke-width: 2;');
    expect(styles).toContain('.edge-history-event.edge-ref-annotation { stroke-dasharray: none;');
    expect(styles).not.toContain('.edge { color: var(--operation-overlay-accent);');
  });

  it('renders the annotation row label with the operation transition', () => {
    expect(operationAnnotationLabel(amend)).toBe('Amend · main: 3d285090 → ca53af21');
    expect(operationAnnotationLabel({ ...amend, refName: 'HEAD' })).toBe('Amend · 3d285090 → ca53af21');
    expect(styles).toContain('.operation-annotation-detail');
    expect(styles).toContain('text-overflow: ellipsis;');
  });
});
