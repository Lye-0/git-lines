import type { CSSProperties } from 'react';
import type { GraphNode, GraphTrack } from '../../../src/model/graphModel';
import { specialRefBadge } from '../../../src/model/refDisplay';
import { eventLabelForWidth, eventMainLabel, eventTooltip, isRefEvent } from './eventPresentation';
import { summarizeWorkingTree, workingTreeStateLabel } from './workingTreePresentation';
import { commitChangeStats } from './commitStatsPresentation';
import { ChangeStatsGrid } from './ChangeStatsGrid';

function kindLabel(kind: GraphNode['kind']): string | undefined {
  if (kind === 'reflog-commit') return 'Reflog-only';
  if (kind === 'working-tree') return 'Working Tree';
  if (kind === 'operation') return 'Operation';
  if (kind === 'history-boundary') return 'History boundary';
  return undefined;
}

function relativeTime(timestamp: number | undefined): string | undefined {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  const delta = Date.now() - timestamp;
  const future = delta < 0;
  const seconds = Math.max(1, Math.round(Math.abs(delta) / 1000));
  const value = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : seconds < 86400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86400)}d`;
  return future ? `in ${value}` : `${value} ago`;
}

function workingSummary(node: GraphNode): { title: string; detail: string } | undefined {
  const tree = node.workingTree;
  if (!tree) return undefined;
  const location = tree.detached ? 'HEAD (detached)' : tree.branch ? `${tree.branch} ★` : 'No branch';
  const state = workingTreeStateLabel(tree);
  const title = tree.mainWorktree === false ? 'Worktree' : 'Working Tree';
  const pathDetail = tree.mainWorktree === false ? ` · ${tree.path}` : '';
  return { title, detail: `${location} · ${state}${pathDetail}` };
}

function operationSummary(node: GraphNode): string | undefined {
  if (!node.operation) return undefined;
  return node.operation.detail || (node.operation.sourceOids.length ? `${node.operation.sourceOids.length} source commit${node.operation.sourceOids.length === 1 ? '' : 's'}` : 'Waiting for Git to finish');
}

export function CommitRow({ node, rowHeight, selected, hidden, onSelect, tracks = [], eventLabelWidth, eventLabelX = 0, showWorkingTreeStats = true }: { node: GraphNode; rowHeight: number; selected: boolean; hidden?: boolean; onSelect: (oid: string) => void; tracks?: GraphTrack[]; eventLabelWidth?: number; eventLabelX?: number; showWorkingTreeStats?: boolean }) {
  const isSelectable = Boolean(node.oid && (node.kind === 'commit' || node.kind === 'reflog-commit'));
  const working = workingSummary(node);
  const operation = operationSummary(node);
  const refEvent = isRefEvent(node);
  // The title already identifies these state rows ("Working Tree" or
  // "Merge in progress"); repeating a second kind label only adds noise.
  const kind = refEvent || node.kind === 'working-tree' || node.kind === 'operation' ? undefined : kindLabel(node.kind);
  const title = working?.title ?? node.label ?? node.subject ?? '';
  const subtitle = working?.detail ?? operation;
  // Ref Event text is rendered in the shared content column.  Repeating the
  // affected refs as badges would make the annotation look like a second ref
  // row; detailed affected-ref data remains available in its tooltip.
  const badges = refEvent ? [] : node.refBadges ?? node.refIds.map((name) => specialRefBadge(name));
  const commitMeta = node.commit
    ? [node.commit.oid.slice(0, 8), node.commit.authorName, relativeTime(node.commit.committerDate)].filter(Boolean).join(' · ')
    : undefined;
  const workingStats = node.kind === 'working-tree' && showWorkingTreeStats && node.workingTree && node.workingTree.mainWorktree !== false
    ? summarizeWorkingTree(node.workingTree)
    : undefined;
  const changeStats = (node.kind === 'commit' || node.kind === 'reflog-commit')
    ? commitChangeStats(node.commit)
    : workingStats && !workingStats.clean && !workingStats.inaccessible
      ? { files: workingStats.files, additions: workingStats.additions, deletions: workingStats.deletions }
      : undefined;
  const primaryTrack = node.trackId ? tracks.find((track) => track.id === node.trackId) : undefined;
  const rowStyle = { top: (node.row ?? 0) * rowHeight, minHeight: rowHeight, '--row-height': `${rowHeight}px`, '--row-track-color': primaryTrack?.color } as CSSProperties;
  if (refEvent) {
    const fullEventLabel = eventMainLabel(node);
    const eventLabel = eventLabelForWidth(node, eventLabelWidth ?? Number.POSITIVE_INFINITY, eventLabelX);
    const tooltip = eventTooltip(node);
    return <div className={`commit-row row-${node.kind}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
      <div className="row-content event-row-content">
        <div className="row-primary">
          <div className="row-text">
            <span className="subject event-subject" title={tooltip}>{eventLabel}</span>
            <span className="sr-only">{fullEventLabel}. {tooltip}</span>
          </div>
        </div>
      </div>
    </div>;
  }
  const content = <div className={`row-content${selected ? ' selected' : ''}${changeStats ? ' has-change-stats' : ''}`}>
    <div className="row-content-main">
      <div className="row-primary">
        {kind && <span className="row-kind">{kind}</span>}
        <div className="row-text">
          <div className="row-heading">
            <span className="subject" title={node.subject ?? node.label}>{title}</span>
            {badges.length > 0 && <div className="row-meta">
              {badges.map((badge) => {
                const track = tracks.find((candidate) => candidate.refNames.includes(badge.fullName));
                const style = { '--badge-color': track?.color } as CSSProperties;
                return <span className={`ref-badge ref-badge-${badge.kind}${badge.isDefault ? ' default' : ''}`} style={style} key={badge.fullName} title={badge.name}>{badge.name}{badge.isDefault ? ' · default' : ''}</span>;
              })}
            </div>}
          </div>
          {subtitle && <span className="row-subtitle" title={subtitle}>{subtitle}</span>}
          {commitMeta && <span className="commit-meta" title={new Date(node.commit!.committerDate).toLocaleString()}>{commitMeta}</span>}
        </div>
      </div>
    </div>
    {changeStats && <ChangeStatsGrid stats={changeStats} className="row-change-stats" ariaLabel={`${changeStats.files} files, ${changeStats.additions} additions, ${changeStats.deletions} deletions`} />}
  </div>;
  const secondaryWorktree = node.workingTree?.mainWorktree === false;
  const compact = rowHeight <= 32;
  return <div className={`commit-row row-${node.kind}${compact ? ' compact-row' : ''}${secondaryWorktree ? ' secondary-worktree' : ''}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
    {isSelectable ? <button type="button" className="row-button" aria-label={`${title}${commitMeta ? `, ${commitMeta}` : ''}`} aria-pressed={selected} onClick={() => onSelect(node.oid!)}>{content}</button> : content}
  </div>;
}
