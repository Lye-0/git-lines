import type { GitRef, ReflogEntry } from '../git/gitTypes.js';

export interface BranchLineage { parent: string; child: string; base: string }

export function lineageFamily(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
}

/** Reflog evidence for a branch's source; not ancestry inferred from today's tips. */
export function branchLineage(entries: ReflogEntry[]): BranchLineage[] {
  const results: BranchLineage[] = [];
  for (const entry of entries) {
    if (!entry.refName.startsWith('refs/heads/') || !entry.subject.startsWith('branch: Created from ')) continue;
    const child = lineageFamily(entry.refName);
    let parent = entry.subject.slice('branch: Created from '.length);
    if (parent === 'HEAD') {
      // Branch creation has no independently ordered HEAD log entry. Equal
      // times/OIDs cannot disambiguate a later checkout among shared refs.
      const possible = new Set(entries.filter((e) => e.refName.startsWith('refs/heads/') && e.refName !== entry.refName && e.newOid === entry.newOid).map((e) => lineageFamily(e.refName)));
      if (possible.size > 1) continue;
      const matches = entries.filter((e) => (e.refName === 'HEAD' || /\/HEAD$/.test(e.refName))
        && e.newOid === entry.newOid && e.previousOid === entry.newOid && e.timestamp === entry.timestamp
        && e.subject.endsWith(` to ${child}`) && e.subject.startsWith('checkout: moving from '));
      const sources = new Set(matches.map((e) => e.subject.slice('checkout: moving from '.length, -` to ${child}`.length)));
      if (sources.size !== 1) continue;
      parent = [...sources][0];
    }
    parent = lineageFamily(parent);
    if (parent === child || /[~^:?*\[\s]|\.\.|@\{|\\/.test(parent) || /^(?:HEAD|[0-9a-f]{7,64})$/.test(parent)) continue;
    results.push({ parent, child, base: entry.newOid });
  }
  // Recreated names with conflicting sources are not a reliable single lineage.
  const parents = new Map<string, Set<string>>();
  for (const relation of results) {
    const names = parents.get(relation.child) ?? new Set<string>();
    names.add(relation.parent); parents.set(relation.child, names);
  }
  return results.filter((r) => parents.get(r.child)?.size === 1);
}

/** Keep a known source as the baseline, even when the current checkout is a child. */
export function sourcePrimaryBranch(refs: GitRef[], primary: string | undefined, relations: BranchLineage[], explicit?: string): string | undefined {
  if (explicit) return explicit;
  const names = new Map(refs.filter((r) => r.type === 'local').map((r) => [lineageFamily(r.fullName), r.shortName]));
  for (const ref of refs.filter((r) => r.type === 'remote')) if (!names.has(lineageFamily(ref.fullName))) names.set(lineageFamily(ref.fullName), ref.shortName);
  let current = primary;
  const initialRef = refs.find((r) => r.fullName === current || r.shortName === current);
  let name = initialRef ? lineageFamily(initialRef.fullName) : current;
  const seen = new Set<string>();
  while (name) {
    if (seen.has(name)) return primary;
    seen.add(name);
    const relation = relations.find((r) => r.child === name && names.has(r.parent));
    if (!relation) break;
    current = names.get(relation.parent); name = relation.parent;
  }
  return current;
}
