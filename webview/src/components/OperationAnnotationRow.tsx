import type { CSSProperties } from 'react';
import type { OverlayRelation } from '../../../src/model/graphModel';
import { operationAnnotationLabel, operationAnnotationParts, operationAnnotationTooltip } from './operationPresentation';

export function OperationAnnotationRow({ relation, row, rowHeight, hidden = false, selected = false, onSelectEvent }: { relation: OverlayRelation; row: number; rowHeight: number; hidden?: boolean; selected?: boolean; onSelectEvent: (id: string) => void }) {
  const label = operationAnnotationLabel(relation);
  const tooltip = operationAnnotationTooltip(relation);
  const style = { top: row * rowHeight, minHeight: rowHeight, '--row-height': `${rowHeight}px` } as CSSProperties;
  const content = <div className={`row-content operation-annotation-row-content${selected ? ' selected' : ''}`}>
    <span className="operation-annotation-detail" title={tooltip}>{operationAnnotationParts(relation).map((part, index) => (
      <span key={index} className={part.className}>{part.text}</span>
    ))}</span>
  </div>;
  return <div className={`commit-row operation-annotation-row${hidden ? ' filtered-out' : ''}`} style={style} role="note" aria-label={label}>
    <button type="button" className="row-button operation-annotation-row-button" aria-label={label} aria-pressed={selected} onClick={() => onSelectEvent(relation.id)}>{content}</button>
  </div>;
}
