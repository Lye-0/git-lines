import type { GitCommitDetail, GitFileChange } from '../../../src/git/gitTypes';

export function shortHash(oid: string, length = 8): string {
  return oid.slice(0, length);
}

export function detailFileChanges(detail: GitCommitDetail): GitFileChange[] {
  if (detail.fileChanges?.length) return detail.fileChanges;
  return detail.files.map((path) => ({ path, status: 'M' }));
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
