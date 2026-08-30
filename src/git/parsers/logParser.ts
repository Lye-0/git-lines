import type { GitCommit } from '../gitTypes.js';
import { parseNumstat, sumNumstat } from './diffParser.js';

const FIELD_COUNT = 10;
const LOG_FIELDS = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s'];

function parseDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Parses records emitted by --format with NUL-separated fields and an ASCII record separator. */
export function parseGitLogNul(output: string): GitCommit[] {
  const records = output.split('\x1e');
  const commits: GitCommit[] = [];
  for (const record of records) {
    const fields = record.replace(/^\r?\n/, '').replace(/\r?\n$/, '').split('\0');
    if (!fields[0] || !/^[0-9a-f]{7,64}$/i.test(fields[0])) continue;
    const padded = fields.length >= FIELD_COUNT ? fields : [...fields, ...Array(FIELD_COUNT - fields.length).fill('')];
    commits.push({
      oid: padded[0],
      parentOids: padded[1] ? padded[1].split(/\s+/).filter(Boolean) : [],
      authorName: padded[2],
      authorEmail: padded[3] || undefined,
      authorDate: parseDate(padded[4]),
      committerName: padded[5],
      committerEmail: padded[6] || undefined,
      committerDate: parseDate(padded[7]),
      subject: padded[8],
      body: padded[9] || undefined,
    });
  }
  return commits;
}

/**
 * Parses the compact records emitted by `git log --numstat`.
 *
 * The record separator is emitted before each commit so that the numstat
 * lines that follow a commit stay in the same record.  This lets callers load
 * commit metadata and change totals in one Git invocation rather than
 * running a separate diff command for every row.
 */
export function parseGitLogNumstat(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of output.split('\x1e')) {
    const fields = record.replace(/^\r?\n+/, '').split('\0');
    const oid = fields[0];
    if (!oid || !/^[0-9a-f]{7,64}$/i.test(oid)) continue;
    const metadata = fields.length >= LOG_FIELDS.length ? fields : [...fields, ...Array(LOG_FIELDS.length - fields.length).fill('')];
    const statsText = metadata.slice(LOG_FIELDS.length).join('\0');
    const entries = parseNumstat(statsText);
    const { additions, deletions } = sumNumstat(entries);
    commits.push({
      oid,
      parentOids: metadata[1] ? metadata[1].split(/\s+/).filter(Boolean) : [],
      authorName: metadata[2] ?? '',
      authorEmail: metadata[3] || undefined,
      authorDate: parseDate(metadata[4] ?? ''),
      committerName: metadata[5] ?? '',
      committerEmail: metadata[6] || undefined,
      committerDate: parseDate(metadata[7] ?? ''),
      subject: metadata[8] ?? '',
      changedFiles: entries.length,
      additions,
      deletions,
    });
  }
  return commits;
}

export function gitLogFormat(includeBody = false): string {
  const fields = [...LOG_FIELDS];
  if (includeBody) fields.push('%B');
  return `${fields.join('%x00')}%x00%x1e`;
}

/** Format for a batch metadata + numstat log.  RS starts each record. */
export function gitLogNumstatFormat(): string {
  return `%x1e${LOG_FIELDS.join('%x00')}%x00`;
}
