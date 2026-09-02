import React, { type CSSProperties } from 'react';
import type { GraphNode, GraphTrack } from '../../../src/model/graphModel';
import { specialRefBadge } from '../../../src/model/refDisplay';
import { eventLabelForWidth, eventLabelParts, eventMainLabel, eventTooltip, isRefEvent } from './eventPresentation';
import { linkedWorktreeTooltip, operationInProgressLabel, summarizeWorkingTree, workingTreeStateLabel } from './workingTreePresentation';
import { commitChangeStats } from './commitStatsPresentation';
import { commitMetaText, commitRowPresentation } from './commitRowPresentation';
import { ChangeStatsGrid } from './ChangeStatsGrid';
import { routeNameForNode } from './routePresentation';

function kindLabel(kind: GraphNode['kind']): string | undefined {
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

function isCurrentWorktree(tree: NonNullable<GraphNode['workingTree']>): boolean {
  return tree.currentWorktree === true || (tree.currentWorktree === undefined && tree.mainWorktree !== false);
}

function workingSummary(node: GraphNode): { title: string; detail: string; operation?: string } | undefined {
  const tree = node.workingTree;
  if (!tree) return undefined;
  const location = tree.detached ? 'HEAD (detached)' : tree.branch ? `${tree.branch} ★` : 'No branch';
  const state = workingTreeStateLabel(tree);
  const linked = !isCurrentWorktree(tree);
  const title = linked ? 'Worktree' : 'Working Tree';
  const pathDetail = linked ? ` · ${tree.path}` : '';
  const operation = node.operation ? operationInProgressLabel(node.operation) : undefined;
  return { title, detail: `${location} · ${state}${pathDetail}`, operation };
}

function operationSummary(node: GraphNode): string | undefined {
  if (!node.operation) return undefined;
  return node.operation.detail || (node.operation.sourceOids.length ? `${node.operation.sourceOids.length} source commit${node.operation.sourceOids.length === 1 ? '' : 's'}` : 'Waiting for Git to finish');
}

export function CommitRow({ node, rowHeight, selected, selectedEvent = false, hidden, onSelect, onSelectEvent, onSelectWorkingTree, tracks = [], eventLabelWidth, eventLabelX = 0, showWorkingTreeStats = true }: { node: GraphNode; rowHeight: number; selected: boolean; selectedEvent?: boolean; hidden?: boolean; onSelect: (oid: string) => void; onSelectEvent?: (id: string) => void; onSelectWorkingTree?: (id: string) => void; tracks?: GraphTrack[]; eventLabelWidth?: number; eventLabelX?: number; showWorkingTreeStats?: boolean }) {
  const isSelectable = Boolean(node.oid && (node.kind === 'commit' || node.kind === 'reflog-commit'));
  const isSelectableWorkingTree = node.kind === 'working-tree' && Boolean(onSelectWorkingTree);
  const working = workingSummary(node);
  const operation = operationSummary(node);
  const refEvent = isRefEvent(node);
  const rowPresentation = commitRowPresentation(node);
  const previousRoute = rowPresentation.previousRoute;
  const historicalBadgeLabel = rowPresentation.historicalBadgeLabel;
  const linkedWorktrees = node.linkedWorktrees ?? [];
  const linkedWorktreeInfo = linkedWorktreeTooltip(linkedWorktrees);
  // The title already identifies these state rows ("Working Tree" or
  // "Merge in progress"); repeating a second kind label only adds noise.
  const kind = refEvent || node.kind === 'working-tree' || node.kind === 'operation' ? undefined : kindLabel(node.kind);
  const title = working?.title ?? node.label ?? node.subject ?? '';
  const subtitle = working?.detail ?? operation;
  // Ref Event text is rendered in the shared content column.  Repeating the
  // affected refs as badges would make the annotation look like a second ref
  // row; detailed affected-ref data remains available in its tooltip.
  const badges = refEvent ? [] : node.refBadges ?? node.refIds.map((name) => specialRefBadge(name));
  const routeName = routeNameForNode(node, tracks);
  const commitMeta = node.commit
    ? commitMetaText(node.commit.oid, routeName, relativeTime(node.commit.committerDate))
    : undefined;
  const ariaLabel = [title, working?.operation ? `+ ${working.operation}` : undefined, subtitle, commitMeta, linkedWorktreeInfo].filter(Boolean).join(', ');
  const workingStats = node.kind === 'working-tree' && showWorkingTreeStats && node.workingTree && isCurrentWorktree(node.workingTree)
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
    const eventLabelContent = eventLabelParts(node, eventLabel).map((part, index) => (
      <span className={part.className} key={(part.className ?? 'text') + index}>{part.text}</span>
    ));
    const eventContent = <div className={`row-content event-row-content${selectedEvent ? ' selected' : ''}`}>
        <div className="row-primary">
          <div className="row-text">
            <span className="subject event-subject" title={tooltip}>{eventLabelContent}</span>
            <span className="sr-only">{fullEventLabel}. {tooltip}</span>
          </div>
        </div>
      </div>;
    const eventButton = node.event && onSelectEvent
      ? <button type="button" className="row-button event-row-button" aria-label={fullEventLabel} aria-pressed={selectedEvent} onClick={() => onSelectEvent(node.event!.id)}>{eventContent}</button>
      : eventContent;
    return <div className={`commit-row row-${node.kind}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
      {eventButton}
    </div>;
  }
  const content = <div className={`row-content${selected ? ' selected' : ''}${changeStats ? ' has-change-stats' : ''}${linkedWorktrees.length > 0 ? ' linked-worktree-row' : ''}`} title={linkedWorktreeInfo}>
    <div className="row-content-main">
      <div className="row-primary">
        {kind && <span className="row-kind">{kind}</span>}
        <div className="row-text">
          <div className="row-heading">
            {rowPresentation.previousBadgeLabel && <span className="previous-badge" title="Previous route">{rowPresentation.previousBadgeLabel}</span>}
            {historicalBadgeLabel && <span className="previous-badge" title="Historical route classification">{historicalBadgeLabel}</span>}
            {linkedWorktrees.length > 0 && <span className="linked-worktree-label" title={linkedWorktreeInfo}><span className="linked-worktree-icon" aria-hidden="true">□</span> Linked Worktree{linkedWorktrees.length > 1 ? ` ×${linkedWorktrees.length}` : ''}</span>}
            <span className={`subject${previousRoute ? ' previous-subject' : ''}`} title={node.subject ?? node.label}>{title}</span>
            {working?.operation && <span className="working-operation" title={working.operation}>{`(+ ${working.operation})`}</span>}
            {badges.length > 0 && <div className="row-meta">
              {badges.map((badge) => {
                const track = tracks.find((candidate) => candidate.refNames.includes(badge.fullName));
                const style = { '--badge-color': track?.color } as CSSProperties;
                return <span className={`ref-badge ref-badge-${badge.kind}${badge.isDefault ? ' default' : ''}`} style={style} key={badge.fullName} title={badge.name}>{badge.name}{badge.isDefault ? ' · default' : ''}</span>;
              })}
            </div>}
          </div>
          {subtitle && <span className="row-subtitle" title={subtitle}>{subtitle}</span>}
          {commitMeta && <span className="commit-meta" title={routeName ?? commitMeta}>{commitMeta}</span>}
        </div>
      </div>
    </div>
    {changeStats && <ChangeStatsGrid stats={changeStats} className="row-change-stats" ariaLabel={`${changeStats.files} files, ${changeStats.additions} additions, ${changeStats.deletions} deletions`} />}
  </div>;
  const secondaryWorktree = node.workingTree ? !isCurrentWorktree(node.workingTree) : false;
  const compact = rowHeight <= 32;
  return <div className={`commit-row row-${node.kind}${previousRoute ? ' previous-row' : ''}${compact ? ' compact-row' : ''}${secondaryWorktree ? ' secondary-worktree' : ''}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
    {isSelectableWorkingTree ? <button type="button" className="row-button" aria-label={ariaLabel} aria-pressed={selected} onClick={() => onSelectWorkingTree!(node.id)}>{content}</button> : isSelectable ? <button type="button" className="row-button" aria-label={ariaLabel} aria-pressed={selected} onClick={() => onSelect(node.oid!)}>{content}</button> : content}
  </div>;
}
