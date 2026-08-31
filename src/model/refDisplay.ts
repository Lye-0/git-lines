import type { GitRef } from '../git/gitTypes.js';

export type GraphRefBadgeKind = 'local' | 'remote' | 'tag' | 'special';

export interface GraphRefBadge {
  fullName: string;
  name: string;
  kind: GraphRefBadgeKind;
  isDefault?: boolean;
}

/** Converts Git's internal ref names into concise labels for the UI. */
export function normalizeRefName(value: string): string {
  const refName = value.trim();
  if (refName.startsWith('refs/heads/')) return refName.slice('refs/heads/'.length);
  if (refName.startsWith('refs/remotes/')) return refName.slice('refs/remotes/'.length);
  if (refName.startsWith('refs/tags/')) return refName.slice('refs/tags/'.length);
  if (refName.startsWith('refs/')) return refName.slice('refs/'.length);
  return refName;
}

/**
 * Returns the logical branch family used by the graph layout.  A local branch
 * keeps its complete name, while a remote-tracking ref drops only the remote
 * name from Git's canonical `refs/remotes/<remote>/<branch>` form.  Using the
 * ref type and canonical name avoids treating a local `alice/feature` branch
 * as the same family as the remote `alice/feature` ref.
 */
export function branchFamilyForRef(ref: Pick<GitRef, 'fullName' | 'shortName' | 'type'>): string {
  const normalized = normalizeRefName(ref.fullName || ref.shortName);
  if (ref.type !== 'remote') return normalized;

  if (ref.fullName.startsWith('refs/remotes/')) {
    const remoteBranch = ref.fullName.slice('refs/remotes/'.length);
    const separator = remoteBranch.indexOf('/');
    return separator >= 0 ? remoteBranch.slice(separator + 1) : remoteBranch;
  }

  const separator = normalized.indexOf('/');
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

export function badgeKind(ref: GitRef | undefined, fullName: string): GraphRefBadgeKind {
  if (fullName === 'ORIG_HEAD' || fullName === 'AUTO_MERGE') return 'special';
  if (fullName.startsWith('refs/remotes/') && fullName.endsWith('/HEAD')) return 'special';
  if (ref?.type === 'local') return 'local';
  if (ref?.type === 'remote') return 'remote';
  if (ref?.type === 'tag') return 'tag';
  if (fullName.startsWith('refs/heads/')) return 'local';
  if (fullName.startsWith('refs/remotes/')) return 'remote';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return 'special';
}

export function toGraphRefBadge(ref: GitRef): GraphRefBadge {
  return {
    fullName: ref.fullName,
    name: normalizeRefName(ref.fullName),
    kind: badgeKind(ref, ref.fullName),
    isDefault: ref.isDefault,
  };
}

export function specialRefBadge(fullName: string): GraphRefBadge {
  return { fullName, name: normalizeRefName(fullName), kind: 'special' };
}

export function isUserFacingRef(ref: GitRef): boolean {
  const pseudo = ref.fullName === 'ORIG_HEAD' || ref.fullName === 'AUTO_MERGE';
  const symbolicRemoteHead = ref.fullName.startsWith('refs/remotes/') && ref.fullName.endsWith('/HEAD');
  return !pseudo && !symbolicRemoteHead && (ref.type === 'local' || ref.type === 'remote' || ref.type === 'tag');
}

/**
 * Sorts badges by their relationship to the currently checked-out branch so
 * the most useful ref is adjacent to the commit text.  The optional branch
 * argument is a short local branch name (for example `feature/login`).
 */
export function uniqueGraphRefBadges(badges: GraphRefBadge[], currentBranch?: string): GraphRefBadge[] {
  const byFullName = new Map<string, GraphRefBadge>();
  for (const badge of badges) byFullName.set(badge.fullName, badge);
  const normalizedCurrent = currentBranch ? normalizeRefName(currentBranch) : undefined;
  const priority = (badge: GraphRefBadge): number => {
    if (badge.kind === 'local') return normalizedCurrent && badge.name === normalizedCurrent ? 0 : 1;
    if (badge.kind === 'remote') {
      const corresponding = normalizedCurrent && badge.name.endsWith(`/${normalizedCurrent}`);
      return corresponding ? 2 : 3;
    }
    if (badge.kind === 'tag') return 4;
    return 5;
  };
  return [...byFullName.values()].sort((a, b) => priority(a) - priority(b)
    || Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))
    || a.name.localeCompare(b.name)
    || a.fullName.localeCompare(b.fullName));
}
