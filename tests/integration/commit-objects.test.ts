import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../src/git/gitRunner.js';
import { GitClient } from '../../src/git/gitClient.js';
import { parseCommitObject } from '../../src/git/parsers/commitObjectParser.js';
import { gitLogFormat, parseGitLogNul } from '../../src/git/parsers/logParser.js';
import { createGitFixture, commitFixture } from '../fixtures/gitFixture.js';

describe('raw supplemental commits', () => {
  it('falls back to Git for a legacy encoding unsupported by TextDecoder', async () => {
    const fixture = createGitFixture();
    try {
      commitFixture(fixture, 'Base', '2025-01-01T00:00:00Z');
      const parent = fixture.run(['rev-parse', 'HEAD']).trim();
      const tree = fixture.run(['rev-parse', 'HEAD^{tree}']).trim();
      const raw = `tree ${tree}\nparent ${parent}\nauthor Legacy <a@example.test> 1735689600 +0000\ncommitter Legacy <a@example.test> 1735689600 +0000\nencoding UTF-7\n\nLegacy +ZeVnLIqe-\n`;
      const oid = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: fixture.root, input: raw, encoding: 'utf8', windowsHide: true }).trim();
      fixture.run(['update-ref', '--create-reflog', 'refs/heads/legacy', oid]);
      fixture.run(['update-ref', 'refs/heads/legacy', parent]);
      const commands: string[] = [];
      const snapshot = await new GitClient({ runner: new GitRunner('git', (command) => commands.push(command)) }).readSnapshot(fixture.root, 1, true);
      expect(snapshot.commits.find((commit) => commit.oid === oid)).toEqual(parseGitLogNul(fixture.run(['show', '-s', `--format=${gitLogFormat(false)}`, oid]))[0]);
      expect(commands).toContain('show');
    } finally { fixture.dispose(); }
  });
  it('matches Git pretty metadata for unicode, multiline subjects, timezone offsets and merge parents', async () => {
    const fixture = createGitFixture();
    try {
      commitFixture(fixture, 'Base', '2025-01-01T00:00:00Z');
      const parent = fixture.run(['rev-parse', 'HEAD']).trim();
      const tree = fixture.run(['rev-parse', 'HEAD^{tree}']).trim();
      const raw = `tree ${tree}\nparent ${parent}\nparent ${parent}\nauthor 著者 <author@example.test> 1735689600 +0900\ncommitter 更新者 <committer@example.test> 1735693200 -0700\ngpgsig fake\n signature continuation\nencoding UTF-8\n\n日本語の件名\n折り返し\n\n本文\x1e\n`;
      const oid = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: fixture.root, input: raw, encoding: 'utf8', windowsHide: true }).trim();
      const reader = new GitRunner().openObjectReader({ cwd: fixture.root });
      try {
        const [missing, object, treeObject, base] = await Promise.all(['0'.repeat(40), oid, tree, parent].map((id) => reader.read(id)));
        expect(missing).toBeUndefined();
        expect(parseCommitObject(treeObject!)).toBeUndefined();
        expect(base?.oid).toBe(parent);
        expect(parseCommitObject(object!)).toEqual(parseGitLogNul(fixture.run(['show', '-s', `--format=${gitLogFormat(false)}`, oid]))[0]);
      } finally { await reader.close(); }
    } finally { fixture.dispose(); }
  });
});
