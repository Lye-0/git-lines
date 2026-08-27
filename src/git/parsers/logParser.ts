import type { GitCommit } from '../gitTypes.js';

const FIELD_COUNT = 10;

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

export function gitLogFormat(includeBody = false): string {
  const fields = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%s'];
  if (includeBody) fields.push('%B');
  return `${fields.join('%x00')}%x00%x1e`;
}
