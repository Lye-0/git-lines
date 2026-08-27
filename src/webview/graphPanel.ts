import * as vscode from 'vscode';
import { GitClient } from '../git/gitClient.js';
import type { RepositorySnapshot } from '../git/gitTypes.js';
import { buildGraphFacts } from '../model/graphBuilder.js';
import { createGraphLayout } from '../layout/graphLayout.js';
import { LayoutState } from '../layout/layoutState.js';
import { getWebviewHtml } from './webviewHtml.js';
import { RepositoryWatcher } from '../repository/repositoryWatcher.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messageProtocol.js';

export class GraphPanel {
  public static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly client: GitClient;
  private readonly layoutState = new LayoutState();
  private readonly output: vscode.OutputChannel;
  private snapshot?: RepositorySnapshot;
  private repositoryRoot: string;
  private commitLimit: number;
  private showReflog: boolean;
  private density: 'comfortable' | 'compact';
  private watcher?: RepositoryWatcher;
  private disposed = false;

  private constructor(private readonly context: vscode.ExtensionContext, repositoryRoot: string) {
    this.repositoryRoot = repositoryRoot;
    this.client = new GitClient();
    this.output = vscode.window.createOutputChannel('Branch Graph');
    const config = vscode.workspace.getConfiguration('branchGraph');
    this.commitLimit = config.get<number>('initialCommitCount', 30);
    this.showReflog = config.get<boolean>('showReflog', true);
    this.density = config.get<'comfortable' | 'compact'>('density', 'comfortable');
    this.panel = vscode.window.createWebviewPanel('branchGraph', 'Branch Graph', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
    });
    this.panel.webview.html = getWebviewHtml(this.panel.webview, context.extensionPath);
    this.panel.onDidDispose(() => {
      this.disposed = true;
      this.watcher?.dispose();
      if (GraphPanel.current === this) GraphPanel.current = undefined;
      this.output.dispose();
    }, undefined, context.subscriptions);
    this.panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => this.handleMessage(message), undefined, context.subscriptions);
    GraphPanel.current = this;
  }

  public static open(context: vscode.ExtensionContext, repositoryRoot: string): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return GraphPanel.current;
    }
    return new GraphPanel(context, repositoryRoot);
  }

  public async refresh(): Promise<void> {
    await this.load(false);
  }

  public async loadMore(): Promise<void> {
    const step = vscode.workspace.getConfiguration('branchGraph').get<number>('loadMoreCount', 10);
    this.commitLimit += Math.max(1, step);
    await this.load(true);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (message.type === 'ready' || message.type === 'refresh') await this.load(false);
    else if (message.type === 'loadMore') await this.loadMore();
    else if (message.type === 'select') await this.select(message.oid);
    else if (message.type === 'toggleReflog') {
      this.showReflog = message.enabled;
      await this.load(false);
    } else if (message.type === 'setDensity') {
      this.density = message.density;
      await this.send({ type: 'graph', layout: this.layoutState.layout ?? { nodes: [], edges: [], tracks: [], visibleCommitCount: 0, hasMore: false, rowHeight: 38, laneWidth: 28 }, repository: this.snapshot?.repository ?? ({} as never), workingTrees: this.snapshot?.workingTrees ?? [], reflogEnabled: this.showReflog, density: this.density });
    }
  }

  private async load(isAppend: boolean): Promise<void> {
    if (this.disposed) return;
    await this.send({ type: 'loading', loading: true });
    const started = Date.now();
    try {
      const next = await this.client.readSnapshot(this.repositoryRoot, this.commitLimit, this.showReflog);
      this.snapshot = next;
      if (!this.watcher) {
        this.watcher = new RepositoryWatcher(next.repository.gitDir, {
          onChange: (reason) => {
            this.output.appendLine(`watch ${reason}`);
            void this.load(false);
          },
        });
      }
      const primaryBranch = vscode.workspace.getConfiguration('branchGraph').get<string | null>('primaryBranch', null);
      const facts = buildGraphFacts(next, { showReflog: this.showReflog, primaryBranch });
      const layout = createGraphLayout(facts, {
        visibleCommitCount: next.visibleCommitCount,
        hasMore: next.hasMore,
        primaryBranch: facts.primaryBranch,
        previousRows: isAppend ? this.layoutState.rows : undefined,
        previousLanes: isAppend ? this.layoutState.lanes : undefined,
        rowHeight: this.density === 'compact' ? 30 : 38,
      });
      this.layoutState.set(layout);
      this.output.appendLine(`refresh ${Date.now() - started}ms ${next.repository.root}`);
      await this.send({
        type: 'graph',
        layout,
        repository: next.repository,
        currentBranch: next.workingTrees[0]?.branch,
        workingTrees: next.workingTrees,
        reflogEnabled: this.showReflog,
        density: this.density,
      });
      await this.send({ type: 'detail', detail: null });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`error ${detail}`);
      await this.send({ type: 'error', title: /not a git repository|repository/i.test(detail) ? 'No Git repository found' : 'Unable to read Git repository', detail });
    } finally {
      await this.send({ type: 'loading', loading: false });
    }
  }

  private async select(oid: string): Promise<void> {
    if (!this.snapshot) return;
    try {
      const detail = await this.client.readCommitDetail(this.snapshot.repository.root, oid);
      await this.send({ type: 'detail', detail });
    } catch (error) {
      await this.send({ type: 'error', title: 'Unable to read commit details', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  private async send(message: ExtensionToWebviewMessage): Promise<void> {
    if (!this.disposed) await this.panel.webview.postMessage(message);
  }
}
