import type { GitCommit, GitRef, ReflogEntry } from '../git/gitTypes.js';
import { branchCommitOrigins, isCommitCreationMessage } from './branchProtection.js';

/** Display-route continuity, deliberately separate from proven commit creation.
 * A ref arriving at another branch's tip must not absorb its existing route.
 * Only a complete first-parent range from a proven earlier source tip qualifies.
 */
export function sharedTipRouteAnchors(commits: GitCommit[], refs: GitRef[], logs: ReflogEntry[]): Array<{ tip: string; anchor: string; refName: string }> {
  const live = refs.filter((ref) => ref.type === 'local' && ref.oid);
  const groups = new Map<string, GitRef[]>();
  for (const ref of live) groups.set(ref.oid!, [...(groups.get(ref.oid!) ?? []), ref]);
  const shared = [...groups.values()].filter((group) => group.length > 1);
  if (!shared.length) return [];
  const origins = branchCommitOrigins(logs, commits);
  const latest = new Map(logs.filter((entry) => /@\{0\}$/.test(entry.selector)).map((entry) => [entry.refName, entry]));
  return shared.flatMap((group) => group.flatMap((ref) => {
    const movement = latest.get(ref.fullName), anchor = movement?.previousOid;
    return anchor && movement?.newOid === ref.oid && anchor !== ref.oid && origins.get(anchor) === ref.fullName
      ? [{ tip: ref.oid!, anchor, refName: ref.fullName }] : [];
  }));
}

export function sharedTipRouteContinuity(commits: GitCommit[], refs: GitRef[], logs: ReflogEntry[]): Map<string, string> {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const origins = branchCommitOrigins(logs, commits);
  const creationOids = new Set(logs.filter((entry) => isCommitCreationMessage(entry.subject)).map((entry) => entry.newOid));
  const proposals = new Map<string, Set<string>>();
  for (const { tip, anchor, refName } of sharedTipRouteAnchors(commits, refs, logs)) {
    const range: string[] = [], visited = new Set<string>();
    let current: string | undefined = tip;
    let valid = true;
    while (current !== anchor) {
      if (!current || visited.has(current)) { valid = false; break; }
      visited.add(current);
      const commit = byOid.get(current), origin = origins.get(current);
      // Conflicting or foreign creation evidence takes priority over continuity.
      if (!commit || (creationOids.has(current) && origin !== refName)) { valid = false; break; }
      range.push(current);
      current = commit.parentOids[0];
    }
    if (!valid || !byOid.has(anchor)) continue;
    // The anchor's creation is proven even if branch-birth metadata is absent.
    // Keep it with the continuation rather than leaving a split at the anchor.
    range.push(anchor);
    for (const oid of range) {
      const names = proposals.get(oid) ?? new Set<string>();
      names.add(refName); proposals.set(oid, names);
    }
  }
  return new Map([...proposals].filter(([, names]) => names.size === 1).map(([oid, names]) => [oid, [...names][0]]));
}
