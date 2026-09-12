import * as vscode from 'vscode';
import { GitClient } from '../git/gitClient.js';
import type { HistoryEvent, RepositorySnapshot } from '../git/gitTypes.js';
import { buildGraphFacts } from '../model/graphBuilder.js';
import { createGraphLayout } from '../layout/graphLayout.js';
import { LayoutState } from '../layout/layoutState.js';
import { getWebviewHtml } from './webviewHtml.js';
import { RepositoryWatcher } from '../repository/repositoryWatcher.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messageProtocol.js';

export class GraphViewSession implements vscode.Disposable {
  private readonly messageListener: vscode.Disposable;
  private readonly client: GitClient;
  private readonly layoutState = new LayoutState();
  private readonly output: vscode.OutputChannel;
  private snapshot?: RepositorySnapshot;
  private commitLimit: number;
  private showReflog: boolean;
  private density: 'comfortable' | 'compact';
  private watcher?: RepositoryWatcher;
  private disposed = false;
  private loading = false;
  private pendingReload = false;
  private pendingLayout = false;
  private forceRefresh = false;
  private requestId = 0;
  private readonly renderStarts = new Map<number, number>();
  private commandCount = 0;
  private visibleEvents = new Map<string, HistoryEvent>();

  public constructor(
    context: vscode.ExtensionContext,
    private readonly webview: vscode.Webview,
    public readonly repositoryRoot: string | undefined,
    private readonly presentation: 'standard' | 'sidebar' = 'standard',
  ) {
    this.output = vscode.window.createOutputChannel('Git Lines');
    this.client = new GitClient({
      onTiming: (stage, ms) => { if (!this.disposed) this.output.appendLine(`perf request=${this.requestId} stage=${stage} ms=${ms.toFixed(1)}`); },
      onCommand: (command, ms, bytes, ok) => {
        if (this.disposed) return;
        this.commandCount++;
        this.output.appendLine(`perf request=${this.requestId} git=${command} ms=${ms.toFixed(1)} bytes=${bytes} ok=${ok}`);
      },
    });
    const config = vscode.workspace.getConfiguration('branchGraph');
    this.commitLimit = config.get<number>('initialCommitCount', 30);
    this.showReflog = config.get<boolean>('showReflog', true);
    this.density = config.get<'comfortable' | 'compact'>('density', 'compact');
    this.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(context.extensionUri, 'resources'),
      ],
    };
    this.messageListener = this.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => this.handleMessage(message));
    this.webview.html = getWebviewHtml(this.webview, context.extensionPath);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.messageListener.dispose();
    this.watcher?.dispose();
    this.output.dispose();
  }

  public async refresh(): Promise<void> {
    this.forceRefresh = true;
    await this.load(false);
  }

  public async loadMore(): Promise<void> {
    if (this.loading || (this.snapshot && !this.snapshot.hasMore)) return;
    const step = vscode.workspace.getConfiguration('branchGraph').get<number>('loadMoreCount', 10);
    this.commitLimit += Math.max(1, step);
    await this.load(true);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (message.type === 'rendered') {
      const start = this.renderStarts.get(message.requestId);
      if (start !== undefined) {
        this.output.appendLine(`perf request=${message.requestId} presentedMs=${(performance.now() - start).toFixed(1)} webviewMs=${message.renderMs.toFixed(1)}`);
        this.renderStarts.delete(message.requestId);
      }
    } else if (message.type === 'ready') await this.load(false);
    else if (message.type === 'refresh') await this.refresh();
    else if (message.type === 'loadMore') await this.loadMore();
    else if (message.type === 'select') await this.select(message.oid);
    else if (message.type === 'selectEvent') await this.selectEvent(message.id);
    else if (message.type === 'toggleReflog') {
      this.showReflog = message.enabled;
      await this.load(false);
    } else if (message.type === 'setDensity') {
      this.density = message.density;
      await this.load(false, true);
    }
  }

  private async load(isAppend: boolean, reuseSnapshot = false): Promise<void> {
    if (this.disposed) return;
    if (this.loading) {
      if (reuseSnapshot) this.pendingLayout = true;
      else this.pendingReload = true;
      return;
    }
    if (!this.repositoryRoot) {
      await this.send({ type: 'error', title: 'Open a repository folder', detail: 'Open a Git repository folder in VS Code, then use Git Lines: Open.' });
      return;
    }
    this.loading = true;
    if (this.forceRefresh) {
      this.forceRefresh = false;
      this.client.clearCache();
      reuseSnapshot = false;
    }
    await this.send({ type: 'loading', loading: true });
    const started = Date.now();
    const preciseStart = performance.now();
    const requestId = ++this.requestId;
    const commandsBefore = this.commandCount;
    try {
      const next = reuseSnapshot && this.snapshot ? this.snapshot : await this.client.readSnapshot(this.repositoryRoot, this.commitLimit, this.showReflog);
      if (this.disposed) return;
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
      const factsStart = performance.now();
      const facts = buildGraphFacts(next, { showReflog: this.showReflog, primaryBranch });
      this.output.appendLine(`perf request=${requestId} factsMs=${(performance.now() - factsStart).toFixed(1)}`);
      this.visibleEvents = new Map(facts.events.map((event) => [event.id, event]));
      const layoutStart = performance.now();
      const layout = createGraphLayout(facts, {
        visibleCommitCount: next.visibleCommitCount,
        hasMore: next.hasMore,
        primaryBranch: facts.primaryBranch,
        previousRows: isAppend ? this.layoutState.rows : undefined,
        previousLanes: isAppend || reuseSnapshot ? this.layoutState.lanes : undefined,
        previousNodeLanes: isAppend || reuseSnapshot ? this.layoutState.nodeLanes : undefined,
        rowHeight: this.presentation === 'sidebar' ? 28 : this.density === 'compact' ? 30 : 38,
        laneWidth: this.presentation === 'sidebar' ? 22 : undefined,
      });
      this.layoutState.set(layout);
      this.output.appendLine(`perf request=${requestId} layoutMs=${(performance.now() - layoutStart).toFixed(1)} gitCommands=${this.commandCount - commandsBefore} reuseSnapshot=${reuseSnapshot}`);
      this.output.appendLine(`refresh ${Date.now() - started}ms ${next.repository.root} (limit=${this.commitLimit}, live=${next.visibleCommitCount}, evidence=${next.commits.length - next.visibleCommitCount}, nodes=${layout.nodes.length}, append=${isAppend})`);
      this.renderStarts.set(requestId, preciseStart);
      if (this.renderStarts.size > 20) this.renderStarts.delete(this.renderStarts.keys().next().value!);
      const sendStart = performance.now();
      await this.send({
        type: 'graph',
        presentation: this.presentation,
        requestId,
        layout,
        repository: next.repository,
        currentBranch: next.workingTrees.find((tree) => tree.currentWorktree === true)?.branch ?? next.workingTrees[0]?.branch,
        workingTrees: next.workingTrees,
        reflogEnabled: this.showReflog,
        density: this.density,
      });
      this.output.appendLine(`perf request=${requestId} sendMs=${(performance.now() - sendStart).toFixed(1)}`);
      if (!reuseSnapshot) await this.send({ type: 'detail', detail: null, event: null });
    } catch (error) {
      if (this.disposed) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`error ${detail}`);
      const title = /spawn .*ENOENT|not recognized|cannot find.*git/i.test(detail)
        ? 'Git executable not found'
        : /not a git repository|repository/i.test(detail)
          ? 'No Git repository found'
          : 'Unable to read Git repository';
      await this.send({ type: 'error', title, detail });
    } finally {
      this.loading = false;
      await this.send({ type: 'loading', loading: false });
      if (!this.disposed && (this.pendingReload || this.pendingLayout)) {
        const reuse = !this.pendingReload;
        this.pendingReload = false;
        this.pendingLayout = false;
        await this.load(false, reuse);
      }
    }
  }

  private async select(oid: string): Promise<void> {
    if (!this.snapshot) return;
    try {
      const detail = await this.client.readCommitDetail(this.snapshot.repository.root, oid);
      await this.send({ type: 'detail', detail, event: null });
    } catch (error) {
      await this.send({ type: 'error', title: 'Unable to read commit details', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  private async selectEvent(id: string): Promise<void> {
    const event = this.visibleEvents.get(id);
    if (event) await this.send({ type: 'detail', detail: null, event });
  }

  private async send(message: ExtensionToWebviewMessage): Promise<void> {
    if (!this.disposed) await this.webview.postMessage(message);
  }
}
