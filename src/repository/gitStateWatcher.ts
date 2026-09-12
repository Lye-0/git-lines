import * as vscode from 'vscode';
import path from 'node:path';

interface GitRepository {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
}
interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}
interface GitExtension { getAPI(version: 1): GitApi }

/** Listen to VS Code Git's existing worktree monitoring without issuing status
 * commands through that API (which would trigger another change event). */
export class GitStateWatcher implements vscode.Disposable {
  private disposed = false;
  private readonly listeners: vscode.Disposable[] = [];
  private readonly repositories = new Map<GitRepository, vscode.Disposable>();
  private readonly roots: Set<string>;

  constructor(roots: string[], private readonly onChange: () => void) {
    this.roots = new Set(roots.map(normalize));
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!extension) return;
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (this.disposed) return;
      const api = exports.getAPI(1);
      const attach = (repository: GitRepository) => {
        if (this.disposed || !this.roots.has(normalize(repository.rootUri.fsPath)) || this.repositories.has(repository)) return;
        this.repositories.set(repository, repository.state.onDidChange(() => { if (!this.disposed) this.onChange(); }));
      };
      this.listeners.push(api.onDidOpenRepository((repository) => { attach(repository); if (this.repositories.has(repository)) this.onChange(); }));
      this.listeners.push(api.onDidCloseRepository((repository) => { this.repositories.get(repository)?.dispose(); this.repositories.delete(repository); }));
      api.repositories.forEach(attach);
    } catch {
      // Built-in Git can be disabled; native metadata monitoring is independent.
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const listener of this.listeners) listener.dispose();
    for (const listener of this.repositories.values()) listener.dispose();
    this.repositories.clear();
  }
}

function normalize(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
