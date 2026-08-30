import type { WorkingTreeState } from '../gitTypes.js';

export interface ParsedStatus {
  branch?: string;
  headOid?: string;
  detached: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changedFiles: number;
}

export function parsePorcelainV2(output: string): ParsedStatus {
  const result: ParsedStatus = {
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changedFiles: 0,
  };
  for (const record of output.split('\0')) {
    if (!record) continue;
    if (record.startsWith('# branch.head ')) {
      const branch = record.slice('# branch.head '.length);
      result.detached = branch === '(detached)' || branch === '(unknown)';
      if (!result.detached && branch !== '(initial)') result.branch = branch;
      continue;
    }
    if (record.startsWith('# branch.oid ')) {
      const oid = record.slice('# branch.oid '.length);
      if (/^[0-9a-f]{7,64}$/i.test(oid)) result.headOid = oid;
      continue;
    }
    const kind = record[0];
    if (kind === '1' || kind === '2') {
      result.changedFiles += 1;
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      if (xy[0] && xy[0] !== '.') result.staged += 1;
      if (xy[1] && xy[1] !== '.') result.unstaged += 1;
    } else if (kind === 'u') {
      result.changedFiles += 1;
      result.conflicted += 1;
    } else if (kind === '?') {
      result.changedFiles += 1;
      result.untracked += 1;
    }
  }
  return result;
}

export function toWorkingTreeState(path: string, parsed: ParsedStatus, worktreeId = path): WorkingTreeState {
  return {
    worktreeId,
    path,
    branch: parsed.branch,
    headOid: parsed.headOid,
    detached: parsed.detached,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    conflicted: parsed.conflicted,
    changedFiles: parsed.changedFiles,
    clean: parsed.staged + parsed.unstaged + parsed.untracked + parsed.conflicted === 0,
  };
}
