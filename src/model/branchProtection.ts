import type { GitCommit, ReflogEntry } from '../git/gitTypes.js';

export function isCommitCreationMessage(subject: string): boolean {
  return /^commit(?: \((?:initial|amend)\))?: /.test(subject) || /^merge .*: Merge made by /.test(subject);
}

/** Only commit-creation evidence can establish a branch of origin. FF/ref
 * movement and ancestry alone must never claim an entire imported range. */
export function branchCommitOrigins(entries: ReflogEntry[], commits: GitCommit[]): Map<string, string> {
  const known = new Set(commits.map((c) => c.oid));
  const claims = new Map<string, Set<string>>();
  const claim = (oid: string, ref: string) => {
    if (!known.has(oid)) return;
    const refs = claims.get(oid) ?? new Set<string>(); refs.add(ref); claims.set(oid, refs);
  };
  const creation = isCommitCreationMessage;
  const branchRef = (name: string): string | undefined => /[~^:?*\[\s]|\.\.|@\{|\\/.test(name) || /^(?:[0-9a-f]{7,64}|HEAD|refs\/remotes\/.*|origin\/.*)$/.test(name)
    ? undefined : name.startsWith('refs/heads/') ? name : `refs/heads/${name}`;
  for (const entry of entries) {
    if (entry.refName.startsWith('refs/heads/') && creation(entry.subject)) claim(entry.newOid, entry.refName);
  }
  // HEAD logs are per worktree. Never merge independent logs by wall-clock time.
  const groups = new Map<string, ReflogEntry[]>();
  for (const entry of entries.filter((e) => e.refName === 'HEAD' || /\/HEAD$/.test(e.refName))) {
    const list = groups.get(entry.refName) ?? []; list.push(entry); groups.set(entry.refName, list);
  }
  const index = (entry: ReflogEntry) => Number(/@\{(\d+)\}/.exec(entry.selector)?.[1] ?? NaN);
  for (const list of groups.values()) {
    let branch: string | undefined, previous: ReflogEntry | undefined;
    for (const entry of list.filter((e) => Number.isFinite(index(e))).sort((a, b) => index(b) - index(a))) {
      if (!previous || index(previous) !== index(entry) + 1 || entry.previousOid !== previous.newOid) branch = undefined;
      const checkout = /^checkout: moving from .+ to (.+)$/.exec(entry.subject);
      if (checkout) {
        const destination = checkout[1];
        branch = branchRef(destination);
      } else if (creation(entry.subject)) {
        if (branch) claim(entry.newOid, branch);
      } else if (!/^reset:/.test(entry.subject) && !/^merge\b/.test(entry.subject)) {
        // Rebase/rename/unknown transitions need their own evidence; do not
        // carry a possibly stale branch identity across them.
        branch = undefined;
      }
      previous = entry;
    }
    // A later checkout also proves the branch we just left. This covers
    // linked worktrees whose initial HEAD log has no checkout destination.
    branch = undefined; previous = undefined;
    for (const entry of list.filter((e) => Number.isFinite(index(e))).sort((a, b) => index(a) - index(b))) {
      if (!previous || index(entry) !== index(previous) + 1 || previous.previousOid !== entry.newOid) branch = undefined;
      const checkout = /^checkout: moving from (.+) to .+$/.exec(entry.subject);
      if (checkout) branch = branchRef(checkout[1]);
      else if (creation(entry.subject)) { if (branch) claim(entry.newOid, branch); }
      else if (!/^reset:/.test(entry.subject) && !/^merge\b/.test(entry.subject)) branch = undefined;
      previous = entry;
    }
  }
  return new Map([...claims].filter(([, refs]) => refs.size === 1).map(([oid, refs]) => [oid, [...refs][0]]));
}
