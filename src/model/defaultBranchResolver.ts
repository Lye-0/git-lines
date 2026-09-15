import type { GitRef } from '../git/gitTypes.js';

export interface DefaultBranchTarget { refName: string; branch: string; oid: string; source: 'manual' | 'origin' | 'remote' }

/** Resolve metadata, never infer a remote default from a conventional name. */
export function resolveDefaultBranch(refs: GitRef[], manual?: string): DefaultBranchTarget | undefined {
  if (manual) {
    const ref = refs.find((r) => r.fullName === manual && (r.type === 'local' || r.type === 'remote'));
    return ref?.oid ? { refName: ref.fullName, branch: ref.fullName.replace(/^refs\/(?:heads\/|remotes\/[^/]+\/)/, ''), oid: ref.oid, source: 'manual' } : undefined;
  }
  const heads = refs.filter((r) => r.type === 'symbolic' && /^refs\/remotes\/[^/]+\/HEAD$/.test(r.fullName) && r.targetRef);
  const origin = heads.find((r) => r.fullName === 'refs/remotes/origin/HEAD');
  const candidates = origin ? [origin] : heads;
  const names = new Set(candidates.map((r) => r.targetRef!.replace(/^refs\/remotes\/[^/]+\//, '')));
  if (names.size !== 1) return undefined;
  const branch = [...names][0];
  const ref = refs.find((r) => r.fullName === `refs/heads/${branch}`)
    ?? refs.find((r) => r.fullName === candidates[0]?.targetRef && r.type === 'remote');
  return ref?.oid ? { refName: ref.fullName, branch, oid: ref.oid, source: origin ? 'origin' : 'remote' } : undefined;
}
