import type { GitCommit } from '../gitTypes.js';
import type { GitObject } from '../objectReader.js';

/** Parse raw commit headers, ignoring continuation lines such as signatures. */
export function parseCommitObject(object: GitObject): GitCommit | undefined {
  if (object.type !== 'commit') return undefined;
  const rawHeaders = object.body.subarray(0, object.body.indexOf('\n\n')).toString('ascii');
  const encoding = /\nencoding ([^\n]+)/.exec(rawHeaders)?.[1] ?? 'utf-8';
  // Unsupported legacy encodings are delegated to Git by the caller.
  const text = new TextDecoder(encoding).decode(object.body);
  const boundary = text.indexOf('\n\n');
  if (boundary < 0) return undefined;
  const headers = text.slice(0, boundary).split('\n');
  const person = (kind: string) => {
    const line = headers.find((header) => header.startsWith(`${kind} `)) ?? '';
    const match = new RegExp(`^${kind} (.*) <(.*)> (-?\\d+) [+-]\\d{4}$`).exec(line);
    return { name: match?.[1] ?? '', email: match?.[2] || undefined, date: match ? Number(match[3]) * 1000 : 0 };
  };
  const author = person('author');
  const committer = person('committer');
  const message = text.slice(boundary + 2).replace(/^\s*\n/, '');
  const subject = message.split(/\r?\n\s*\r?\n/, 1)[0].split(/\r?\n/).map((line) => line.trim()).join(' ').trim();
  return { oid: object.oid, parentOids: headers.filter((line) => line.startsWith('parent ')).map((line) => line.slice(7)),
    authorName: author.name, authorEmail: author.email, authorDate: author.date,
    committerName: committer.name, committerEmail: committer.email, committerDate: committer.date, subject, body: undefined };
}
