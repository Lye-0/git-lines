import { describe, expect, it } from 'vitest';
import { parseGitLogNul } from '../../src/git/parsers/logParser.js';
import { parsePorcelainV2 } from '../../src/git/parsers/statusParser.js';
import { parseRefRecords } from '../../src/git/parsers/refParser.js';
import { parseReflogRecords } from '../../src/git/parsers/reflogParser.js';
import { parseWorktreePorcelain } from '../../src/git/parsers/worktreeParser.js';

describe('Git parsers', () => {
  it('parses NUL-delimited commit records without relying on pretty log output', () => {
    const output = ['a'.repeat(40), 'b'.repeat(40), 'A', 'a@example.test', '2026-08-27T10:00:00+09:00', 'C', 'c@example.test', '2026-08-27T10:01:00+09:00', '日本語の件名', ''].join('\0') + '\x1e';
    const [commit] = parseGitLogNul(output);
    expect(commit).toMatchObject({ oid: 'a'.repeat(40), parentOids: ['b'.repeat(40)], subject: '日本語の件名' });
  });

  it('counts porcelain v2 staged, unstaged, untracked and conflicts', () => {
    const output = '# branch.oid abcdef123456\0# branch.head feature/x\0' +
      '1 M. N... 100644 100644 100644 abc abc file.txt\0' +
      '1 .M N... 100644 100644 100644 abc abc other.txt\0' +
      'u UU N... 100644 100644 100644 100644 abc abc abc conflict.txt\0' +
      '? new.txt\0';
    expect(parsePorcelainV2(output)).toMatchObject({ branch: 'feature/x', headOid: 'abcdef123456', staged: 1, unstaged: 1, conflicted: 1, untracked: 1 });
  });

  it('classifies refs and symbolic remote HEAD', () => {
    const record = (fields: string[]) => `${fields.join('\0')}\0`;
    const output = [
      record(['refs/heads/main', 'main', 'a'.repeat(40), '', '', '']),
      record(['refs/remotes/origin/HEAD', 'origin/HEAD', 'a'.repeat(40), 'refs/remotes/origin/main', '', '']),
      record(['refs/remotes/origin/main', 'origin/main', 'a'.repeat(40), '', '', '']),
      record(['refs/tags/v1', 'v1', 'a'.repeat(40), '', '', '']),
    ].join('');
    const refs = parseRefRecords(output);
    expect(refs.find((ref) => ref.fullName === 'refs/heads/main')?.type).toBe('local');
    expect(refs.find((ref) => ref.fullName === 'refs/remotes/origin/HEAD')?.type).toBe('symbolic');
    expect(refs.find((ref) => ref.fullName === 'refs/remotes/origin/HEAD')?.shortName).toBe('origin/HEAD');
    expect(refs.find((ref) => ref.fullName === 'refs/tags/v1')?.type).toBe('tag');
  });

  it('derives previous reflog OID only for adjacent records', () => {
    const output = [
      `${'c'.repeat(40)}\x00HEAD@{0}\x00merge feature: Fast-forward\x001724000000\x00A\x00a@x\x00\x1e`,
      `${'b'.repeat(40)}\x00HEAD@{1}\x00commit: base\x001723999900\x00A\x00a@x\x00\x1e`,
    ].join('');
    const [current] = parseReflogRecords(output, 'HEAD');
    expect(current.previousOid).toBe('b'.repeat(40));
    const gap = `${'c'.repeat(40)}\x00HEAD@{0}\x00reset: gap\x001724000000\x00A\x00a@x\x00\x1e${'a'.repeat(40)}\x00HEAD@{2}\x00commit: base\x001723999900\x00A\x00a@x\x00\x1e`;
    expect(parseReflogRecords(gap, 'HEAD')[0].previousOid).toBeUndefined();
  });

  it('parses linked worktree metadata', () => {
    const worktrees = parseWorktreePorcelain(`worktree C:/repo\nHEAD ${'a'.repeat(40)}\nbranch refs/heads/main\n\nworktree C:/other\nHEAD ${'b'.repeat(40)}\ndetached\n\n`);
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({ branch: 'main', detached: false });
    expect(worktrees[1]).toMatchObject({ detached: true });
  });
});
