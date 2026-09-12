import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock('node:fs', () => ({ default: { watch: mock.watch } }));
import { RepositoryWatcher } from '../../src/repository/repositoryWatcher.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('Git metadata watcher', () => {
  it('watches directories and coalesces new/nested metadata while ignoring objects and locks', async () => {
    vi.useFakeTimers();
    const callbacks: Array<(event: string, file: string) => void> = [];
    const close = vi.fn();
    mock.watch.mockImplementation((_path, options, callback) => {
      expect(options.recursive).toBe(true);
      callbacks.push(callback);
      return { close, on: vi.fn() };
    });
    const onChange = vi.fn();
    const watcher = new RepositoryWatcher('/repo/.git/worktrees/linked', { commonGitDir: '/repo/.git', onChange });
    expect(callbacks).toHaveLength(2);
    callbacks[1]('rename', 'objects/aa/object');
    callbacks[1]('rename', 'index.lock');
    await vi.advanceTimersByTimeAsync(400);
    expect(onChange).not.toHaveBeenCalled();
    callbacks[1]('rename', 'refs\\heads\\feature\\new');
    callbacks[0]('rename', 'MERGE_HEAD');
    callbacks[0]('rename', 'index');
    await vi.advanceTimersByTimeAsync(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('index');
    callbacks[0]('rename', 'index');
    await vi.advanceTimersByTimeAsync(400);
    expect(onChange).toHaveBeenCalledTimes(2);
    watcher.notifyChange('git-state');
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(400);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
