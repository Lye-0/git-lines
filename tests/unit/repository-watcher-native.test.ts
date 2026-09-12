import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { RepositoryWatcher } from '../../src/repository/repositoryWatcher.js';

it('observes new nested refs and repeated atomic metadata replacement on disk', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-watch-'));
  const onChange = vi.fn();
  const watcher = new RepositoryWatcher(directory, { debounceMs: 20, onChange });
  try {
    fs.mkdirSync(path.join(directory, 'refs', 'heads'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'refs', 'heads', 'feature'), 'oid');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    for (const value of ['first', 'second']) {
      onChange.mockClear();
      fs.writeFileSync(path.join(directory, 'index.lock'), value);
      fs.renameSync(path.join(directory, 'index.lock'), path.join(directory, 'index'));
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    }
    onChange.mockClear();
    fs.writeFileSync(path.join(directory, 'MERGE_HEAD'), 'oid');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
  } finally {
    watcher.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
