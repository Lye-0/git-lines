import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createGitFixture(): { root: string; run: (args: string[], env?: NodeJS.ProcessEnv) => string; dispose: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-fixture-'));
  const run = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true });
  run(['init', '-b', 'main']);
  run(['config', 'user.name', 'Git Lines Fixture']);
  run(['config', 'user.email', 'fixture@example.test']);
  return { root, run, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function commitFixture(fixture: ReturnType<typeof createGitFixture>, message: string, date: string): void {
  fs.writeFileSync(path.join(fixture.root, `${message.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`), message);
  fixture.run(['add', '.']);
  fixture.run(['commit', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}
