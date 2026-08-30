import type { GitFileChange } from '../gitTypes.js';

export interface NumstatEntry {
  additions?: number;
  deletions?: number;
}

/** Parses `git diff --name-status` output without interpreting path contents. */
export function parseNameStatus(output: string): GitFileChange[] {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const fields = line.split('\t');
    const rawStatus = fields.shift() ?? 'M';
    const status = rawStatus[0] ?? 'M';
    const paths = fields.filter(Boolean);
    if (!paths.length) return [];
    // Rename/copy records contain old and new paths. Showing both keeps the
    // change understandable while retaining the normal one-letter status.
    const filePath = paths.length > 1 ? `${paths[0]} -> ${paths[paths.length - 1]}` : paths[0];
    return [{ path: filePath, status }];
  });
}

/** Parses the numeric part of `git diff --numstat`; binary files are unknown. */
export function parseNumstat(output: string): NumstatEntry[] {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const fields = line.split('\t');
    if (fields.length < 2) return [];
    const [added, removed] = fields;
    const additions = /^\d+$/.test(added ?? '') ? Number(added) : undefined;
    const deletions = /^\d+$/.test(removed ?? '') ? Number(removed) : undefined;
    // Keep binary (`-\t-`) entries so stats stay aligned with name-status rows.
    return [{ additions, deletions }];
  });
}

export function sumNumstat(entries: NumstatEntry[]): { additions: number; deletions: number } {
  return entries.reduce<{ additions: number; deletions: number }>((total, entry) => ({
    additions: total.additions + (entry.additions ?? 0),
    deletions: total.deletions + (entry.deletions ?? 0),
  }), { additions: 0, deletions: 0 });
}
