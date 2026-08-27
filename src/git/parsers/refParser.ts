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
  // for-each-ref uses the ref-format language, where %00 is the portable NUL atom.
  // Newer Git versions may also append a line ending after each record.
  const fields = output.replace(/[\r\n]/g, '').split('\0');
  for (let index = 0; index + 5 < fields.length;) {
    const [fullName, shortName, oid, symref, upstream, track] = fields.slice(index, index + 6);
    index += 6;
    // Some Git builds append an additional NUL after the format atom.
    if (fields[index] === '') index += 1;
    if (!fullName || fullName.startsWith('%')) continue;
    const parsedTrack = parseTrack(track ?? '');
    refs.push({
      fullName,
      shortName: shortName || fullName.replace(/^refs\//, ''),
      type: refType(fullName, symref ?? ''),
      oid: oid || undefined,
      targetRef: symref || undefined,
      upstream: upstream || undefined,
      ...parsedTrack,
    });
  }
  return refs;
}

export const refFormat = '%(refname)%00%(refname:short)%00%(objectname)%00%(symref)%00%(upstream)%00%(upstream:track)%00';
