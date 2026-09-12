import type { GitCommitDetail, GitFileChange } from '../../../src/git/gitTypes';
import type { GraphHeadState, GraphNode, GraphTrack } from '../../../src/model/graphModel';
import type { GraphRefBadge } from '../../../src/model/refDisplay';

export type DetailRefBadge = GraphRefBadge & { color?: string };

export function shortHash(oid: string, length = 8): string {
  return oid.slice(0, length);
}

export function detailRouteLabel(routeName?: string): string {
  return routeName || 'None';
}

export function detailHeadLabel(headState?: GraphHeadState): string {
  return headState === 'detached' ? 'Detached' : headState === 'attached' ? 'Current' : 'Not current';
}

export function detailFileChanges(detail: GitCommitDetail): GitFileChange[] {
  if (detail.fileChanges?.length) return detail.fileChanges;
  return detail.files.map((path) => ({ path, status: 'M' }));
}

export function resolveDetailRefBadges(node: Pick<GraphNode, 'refBadges'> | undefined, tracks: Pick<GraphTrack, 'refNames' | 'color'>[]): DetailRefBadge[] {
  return (node?.refBadges ?? []).map((badge) => ({
    ...badge,
    color: tracks.find((track) => track.refNames.includes(badge.fullName))?.color,
  }));
}

/** Returns only body text that adds information beyond the commit subject. */
export function commitDescription(detail: GitCommitDetail): string | undefined {
  const body = detail.body?.replace(/\r\n?/g, '\n').trim();
  if (!body) return undefined;
  const subject = detail.subject.trim();
  if (body === subject) return undefined;
  const firstBreak = body.indexOf('\n');
  if (firstBreak >= 0 && body.slice(0, firstBreak).trim() === subject) {
    const remainder = body.slice(firstBreak + 1).trim();
    return remainder && remainder !== subject ? remainder : undefined;
  }
  return body;
}
