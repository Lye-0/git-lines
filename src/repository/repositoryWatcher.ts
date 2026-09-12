import fs from 'node:fs';

export interface RepositoryWatcherOptions {
  debounceMs?: number;
  onChange: (reason: string) => void;
  commonGitDir?: string;
}

/** Best-effort watcher. Network filesystems may reject one or more watches; callers keep manual refresh available. */
export class RepositoryWatcher implements vscodeLikeDisposable {
  private readonly watchers: fs.FSWatcher[] = [];
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private readonly debounceMs: number;
  private readonly onChange: (reason: string) => void;

  public constructor(private readonly gitDir: string, options: RepositoryWatcherOptions) {
    this.debounceMs = options.debounceMs ?? 350;
    this.onChange = options.onChange;
    // Watch directories, not individual inodes: Git replaces refs/index
    // atomically and operation files often do not exist until later.
    for (const target of new Set([gitDir, options.commonGitDir ?? gitDir])) {
      try {
        const watcher = fs.watch(target, { persistent: false, recursive: true }, (_event, filename) => {
          if (this.disposed) return;
          const name = filename?.toString().replaceAll('\\', '/');
          if (name && !isGitStatePath(name)) return;
          this.notifyChange(name ?? 'git-directory');
        });
        watcher.on('error', () => { /* Git API notifications/manual refresh remain available. */ });
        this.watchers.push(watcher);
      } catch {
        // Missing optional files and unsupported network watches are normal.
      }
    }
  }

  public notifyChange(reason: string): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.disposed) this.onChange(reason); }, this.debounceMs);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
  }
}

export function isGitStatePath(name: string): boolean {
  if (name.endsWith('.lock')) return false;
  return /^(?:HEAD|index|packed-refs|config|shallow|ORIG_HEAD|FETCH_HEAD|MERGE_HEAD|MERGE_MSG|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD)$/.test(name)
    || /^(?:refs|logs|worktrees|rebase-merge|rebase-apply|sequencer)(?:\/|$)/.test(name);
}

interface vscodeLikeDisposable { dispose(): void; }
