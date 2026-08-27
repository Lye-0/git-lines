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

export function uniqueGraphRefBadges(badges: GraphRefBadge[]): GraphRefBadge[] {
  const byFullName = new Map<string, GraphRefBadge>();
  for (const badge of badges) byFullName.set(badge.fullName, badge);
  return [...byFullName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.fullName.localeCompare(b.fullName));
}
