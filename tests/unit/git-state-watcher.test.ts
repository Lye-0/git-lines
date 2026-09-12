import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getExtension: vi.fn() }));
vi.mock('vscode', () => ({ extensions: { getExtension: mock.getExtension } }));
import { GitStateWatcher } from '../../src/repository/gitStateWatcher.js';

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return { subscribe: (listener: (value: T) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    fire: (value: T) => listeners.forEach((listener) => listener(value)), get size() { return listeners.size; } };
}
beforeEach(() => vi.clearAllMocks());

describe('VS Code Git state subscription', () => {
  it('subscribes only to relevant repositories and handles later discovery/removal', () => {
    const relevant = event<void>(), unrelated = event<void>();
    const repo = { rootUri: { fsPath: '/repo' }, state: { onDidChange: relevant.subscribe } };
    const other = { rootUri: { fsPath: '/other' }, state: { onDidChange: unrelated.subscribe } };
    const opened = event<typeof repo>(), closed = event<typeof repo>();
    mock.getExtension.mockReturnValue({ isActive: true, exports: { getAPI: () => ({ repositories: [other], onDidOpenRepository: opened.subscribe, onDidCloseRepository: closed.subscribe }) } });
    const change = vi.fn();
    const watcher = new GitStateWatcher(['/repo'], change);
    unrelated.fire();
    expect(change).not.toHaveBeenCalled();
    opened.fire(repo);
    expect(change).toHaveBeenCalledTimes(1);
    relevant.fire();
    expect(change).toHaveBeenCalledTimes(2);
    closed.fire(repo);
    relevant.fire();
    expect(change).toHaveBeenCalledTimes(2);
    watcher.dispose();
    expect(opened.size).toBe(0);
  });

  it('does not attach after disposal while Git activation is pending', async () => {
    let finish!: (api: unknown) => void;
    mock.getExtension.mockReturnValue({ isActive: false, activate: () => new Promise((resolve) => { finish = resolve; }) });
    const watcher = new GitStateWatcher(['/repo'], vi.fn());
    watcher.dispose();
    const getAPI = vi.fn();
    finish({ getAPI });
    await Promise.resolve();
    expect(getAPI).not.toHaveBeenCalled();
  });
});
