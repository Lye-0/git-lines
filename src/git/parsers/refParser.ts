import type { GitRef, GitRefType } from '../gitTypes.js';

function refType(fullName: string, symref: string): GitRefType {
  if (symref) return 'symbolic';
  if (fullName.startsWith('refs/heads/')) return 'local';
  if (fullName.startsWith('refs/remotes/')) return 'remote';
  if (fullName.startsWith('refs/tags/')) return 'tag';
  return 'symbolic';
}

function parseTrack(track: string): { ahead?: number; behind?: number } {
  const ahead = /ahead (\d+)/i.exec(track)?.[1];
  const behind = /behind (\d+)/i.exec(track)?.[1];
  return { ahead: ahead ? Number(ahead) : undefined, behind: behind ? Number(behind) : undefined };
}

export function parseRefRecords(output: string): GitRef[] {
  const refs: GitRef[] = [];
  // for-each-ref uses the ref-format language, where %00 is the portable NUL
  // atom. Git writes one formatted ref per line, so the line boundary is the
  // record separator while NUL keeps empty fields unambiguous. Accept the
  // ASCII record separator too for callers that already provide it.
  const hasRecordSeparator = output.includes('\x1e');
  const records = hasRecordSeparator
    ? output.split('\x1e')
    : output.split(/\r?\n/).filter(Boolean);
  const singleRecordFieldCount = output.replace(/[\r\n]/g, '').split('\0').length;
  const usesPeeledFormat = (records.length > 1 && records.some((record) => record.split('\0').length >= 8))
    || (!hasRecordSeparator && records.length === 1 && (singleRecordFieldCount - 1) % 7 === 0 && (singleRecordFieldCount - 1) % 6 !== 0);
  if (usesPeeledFormat) {
    for (const record of records) {
      const fields = record.split('\0');
      if (fields[fields.length - 1] === '') fields.pop();
      if (fields.length < 6) continue;
      const [fullName, shortName, oid, symref, upstream, track, peeledOid] = fields;
      addRef(refs, fullName, shortName, oid, symref, upstream, track, peeledOid);
    }
    return refs;
  }

  // Keep accepting the six-field format used by older callers and tests.
  // Its trailing NUL is the seventh split field; parse records in fixed
  // six-field groups so empty symref/upstream/track values remain aligned.
  const fields = output.replace(/[\r\n]/g, '').split('\0');
  for (let index = 0; index + 5 < fields.length;) {
    const [fullName, shortName, oid, symref, upstream, track] = fields.slice(index, index + 6);
    index += 6;
    if (fields[index] === '') index += 1;
    addRef(refs, fullName, shortName, oid, symref, upstream, track);
  }
  return refs;
}

function addRef(refs: GitRef[], fullName: string | undefined, shortName: string | undefined, oid: string | undefined, symref: string | undefined, upstream: string | undefined, track: string | undefined, peeledOid?: string): void {
  if (!fullName || fullName.startsWith('%')) return;
  const parsedTrack = parseTrack(track ?? '');
  const parsedShortName = symref && fullName.startsWith('refs/remotes/') && fullName.endsWith('/HEAD')
    ? fullName.slice('refs/remotes/'.length)
    : shortName || fullName.replace(/^refs\//, '');
  refs.push({
    fullName,
    shortName: parsedShortName,
    type: refType(fullName, symref ?? ''),
    // %(objectname) points at an annotated tag object. %(*objectname) is
    // emitted as peeledOid by refFormat and points at
    // the final object, allowing annotated commit tags to share the same
    // badge path as lightweight tags.
    oid: peeledOid || oid || undefined,
    targetRef: symref || undefined,
    upstream: upstream || undefined,
    ...parsedTrack,
  });
}

export const refFormat = '%(refname)%00%(refname:short)%00%(objectname)%00%(symref)%00%(upstream)%00%(upstream:track)%00%(*objectname)%00';
