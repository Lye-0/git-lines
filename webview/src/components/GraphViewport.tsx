import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { GraphSvg } from './GraphSvg';
import { CommitRow } from './CommitRow';

interface Props {
  layout: GraphLayout;
  filter: string;
  selected?: string;
  onSelect: (oid: string) => void;
}

export function GraphViewport({ layout, filter, selected, onSelect }: Props) {
  const maxLane = Math.max(0, ...layout.nodes.map((node) => node.lane ?? 0));
  const graphWidth = Math.max(104, (maxLane + 1) * layout.laneWidth + 36);
  const rowCount = Math.max(1, layout.nodes.length);
  return <section className="graph-section" aria-label="Git commit graph">
    <div className="graph-scroll" role="region" aria-label="Scrollable branch graph" tabIndex={0}>
      <div className="graph-canvas" style={{ minWidth: `calc(${graphWidth}px + 100%)`, minHeight: rowCount * layout.rowHeight }}>
        <GraphSvg layout={layout} width={graphWidth} />
        <div className="rows" style={{ paddingLeft: graphWidth }}>
          {layout.nodes.slice().sort((a, b) => (a.row ?? 0) - (b.row ?? 0)).map((node) => { const needle = filter.trim().toLocaleLowerCase(); const haystack = [node.subject, node.label, node.oid, ...node.refIds].filter(Boolean).join(' ').toLocaleLowerCase(); return <CommitRow key={node.id} node={node} rowHeight={layout.rowHeight} selected={node.oid === selected} hidden={Boolean(needle) && !haystack.includes(needle)} onSelect={onSelect} />; })}
        </div>
      </div>
    </div>
    <div className="legend" aria-label="Graph legend"><span><i className="legend-dot commit-dot">●</i> Commit</span><span><i className="legend-dot work-dot">○</i> Working tree / operation</span><span><i className="legend-dot reflog-dot">◌</i> Reflog-only</span><span><i className="legend-dot ff-dot">◇</i> Ref event</span></div>
  </section>;
}
