import fs from 'node:fs';
import path from 'node:path';

export interface RepositoryWatcherOptions {
  debounceMs?: number;
  onChange: (reason: string) => void;
}

/** Best-effort watcher. Network filesystems may reject one or more watches; callers keep manual refresh available. */
export class RepositoryWatcher implements vscodeLikeDisposable {
  private readonly watchers: fs.FSWatcher[] = [];
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private readonly debounceMs: number;

  public constructor(private readonly gitDir: string, options: RepositoryWatcherOptions) {
    this.debounceMs = options.debounceMs ?? 350;
    const watched = ['HEAD', 'index', 'packed-refs', 'refs', 'logs', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'worktrees'];
    for (const entry of watched) {
      const target = path.join(gitDir, entry);
      try {
        const watcher = fs.watch(target, { persistent: false }, (_event, filename) => {
          if (this.disposed) return;
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => options.onChange(filename ? `${entry}/${filename.toString()}` : entry), this.debounceMs);
        });
        this.watchers.push(watcher);
      } catch {
        // Missing optional files and unsupported network watches are normal.
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
  }
}

interface vscodeLikeDisposable { dispose(): void; }
