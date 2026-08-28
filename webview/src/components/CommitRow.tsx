import type { CSSProperties } from 'react';
import type { GraphNode, GraphTrack } from '../../../src/model/graphModel';
import { specialRefBadge } from '../../../src/model/refDisplay';

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
  const state = tree.inaccessible
    ? 'Status unavailable'
    : tree.conflicted > 0
      ? `${tree.conflicted} conflict${tree.conflicted === 1 ? '' : 's'}`
      : tree.clean
        ? 'Clean'
        : [
            tree.staged ? `${tree.staged} staged` : '',
            tree.unstaged ? `${tree.unstaged} modified` : '',
            tree.untracked ? `${tree.untracked} untracked` : '',
          ].filter(Boolean).join(' · ');
  const title = tree.mainWorktree === false ? 'Worktree' : 'Working Tree';
  const pathDetail = tree.mainWorktree === false ? ` · ${tree.path}` : '';
  return { title, detail: `${location} · ${state}${pathDetail}` };
}

function operationSummary(node: GraphNode): string | undefined {
  if (!node.operation) return undefined;
  return node.operation.detail || (node.operation.sourceOids.length ? `${node.operation.sourceOids.length} source commit${node.operation.sourceOids.length === 1 ? '' : 's'}` : 'Waiting for Git to finish');
}

export function CommitRow({ node, rowHeight, selected, hidden, onSelect, tracks = [] }: { node: GraphNode; rowHeight: number; selected: boolean; hidden?: boolean; onSelect: (oid: string) => void; tracks?: GraphTrack[] }) {
  const isSelectable = Boolean(node.oid && (node.kind === 'commit' || node.kind === 'reflog-commit'));
  const working = workingSummary(node);
  const operation = operationSummary(node);
  const refEvent = node.kind === 'fast-forward-event' || node.kind === 'history-event';
  // The title already identifies these state rows ("Working Tree" or
  // "Merge in progress"); repeating a second kind label only adds noise.
  const kind = refEvent || node.kind === 'working-tree' || node.kind === 'operation' ? undefined : kindLabel(node.kind);
  const title = working?.title ?? node.label ?? node.subject ?? '';
  const subtitle = working?.detail ?? operation;
  // The event label already contains its affected ref.  Repeating the same
  // branch badge beside it makes the annotation look like a second ref row;
  // detailed affected-ref data remains available through the event model.
  const badges = refEvent ? [] : node.refBadges ?? node.refIds.map((name) => specialRefBadge(name));
  const commitMeta = node.commit
    ? [node.commit.oid.slice(0, 8), node.commit.authorName, relativeTime(node.commit.committerDate)].filter(Boolean).join(' · ')
    : undefined;
  const primaryTrack = node.trackId ? tracks.find((track) => track.id === node.trackId) : undefined;
  const rowStyle = { top: (node.row ?? 0) * rowHeight, minHeight: rowHeight, '--row-height': `${rowHeight}px`, '--row-track-color': primaryTrack?.color } as CSSProperties;
  if (refEvent) {
    const eventTime = node.event?.timestamp !== undefined && Number.isFinite(node.event.timestamp)
      ? ` · ${new Date(node.event.timestamp).toLocaleString()}`
      : '';
    return <div className={`commit-row row-${node.kind}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
      <span className="sr-only">{node.label ?? node.subject ?? 'Ref event'}{eventTime}</span>
    </div>;
  }
  const content = <div className={`row-content ${selected ? 'selected' : ''}`}>
    <div className="row-primary">
      {kind && <span className="row-kind">{kind}</span>}
      <div className="row-text">
        <span className="subject" title={node.subject ?? node.label}>{title}</span>
        {subtitle && <span className="row-subtitle" title={subtitle}>{subtitle}</span>}
        {commitMeta && <span className="commit-meta" title={new Date(node.commit!.committerDate).toLocaleString()}>{commitMeta}</span>}
      </div>
    </div>
    {badges.length > 0 && <div className="row-meta">
      {badges.map((badge) => {
        const track = tracks.find((candidate) => candidate.refNames.includes(badge.fullName));
        const style = { '--badge-color': track?.color } as CSSProperties;
        return <span className={`ref-badge ref-badge-${badge.kind}${badge.isDefault ? ' default' : ''}`} style={style} key={badge.fullName} title={badge.name}>{badge.name}{badge.isDefault ? ' · default' : ''}</span>;
      })}
    </div>}
  </div>;
  const secondaryWorktree = node.workingTree?.mainWorktree === false;
  const compact = rowHeight <= 32;
  return <div className={`commit-row row-${node.kind}${compact ? ' compact-row' : ''}${secondaryWorktree ? ' secondary-worktree' : ''}${hidden ? ' filtered-out' : ''}`} style={rowStyle}>
    {isSelectable ? <button type="button" className="row-button" aria-label={`${title}${commitMeta ? `, ${commitMeta}` : ''}`} aria-pressed={selected} onClick={() => onSelect(node.oid!)}>{content}</button> : content}
  </div>;
}
