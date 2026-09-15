import * as vscode from 'vscode';
import { GitClient } from '../git/gitClient.js';
import type { GitCommit, HistoryEvent, RepositorySnapshot, ReflogEntry } from '../git/gitTypes.js';
import { buildGraphFacts } from '../model/graphBuilder.js';
import { createGraphLayout } from '../layout/graphLayout.js';
import { LayoutState } from '../layout/layoutState.js';
import { getWebviewHtml } from './webviewHtml.js';
import { RepositoryWatcher } from '../repository/repositoryWatcher.js';
import { GitStateWatcher } from '../repository/gitStateWatcher.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messageProtocol.js';
import { graphSettings, type GraphSettings, type GraphSettingsService } from '../settings/graphSettings.js';
import { resolveDefaultBranch } from '../model/defaultBranchResolver.js';
import { openSettings } from '../commands/openSettings.js';

export class GraphViewSession implements vscode.Disposable {
  private readonly messageListener: vscode.Disposable;
  private readonly client: GitClient;
  private readonly layoutStates = new Map<string, LayoutState>();
  private readonly settings: GraphSettingsService;
  private readonly settingsListener: vscode.Disposable;
  private settingsValue: GraphSettings;
  private settingsRevision = 0;
  private protectionLogs?: ReflogEntry[];
  private routeEvidence?: GitCommit[];
  private readonly output: vscode.OutputChannel;
  private snapshot?: RepositorySnapshot;
  private commitLimit: number;
  private showReflog: boolean;
  private density: 'comfortable' | 'compact';
  private watcher?: RepositoryWatcher;
  private gitStateWatcher?: GitStateWatcher;
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
    private readonly context: vscode.ExtensionContext,
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
    this.settings = graphSettings(context);
    this.settingsValue = this.settings.read(repositoryRoot);
    this.showReflog = this.settingsValue.showReflog;
    this.density = this.settingsValue.density;
    this.settingsListener = this.settings.onDidChange(() => {
      const value = this.settings.read(this.repositoryRoot);
      const old = this.settingsValue;
      if (JSON.stringify(value) === JSON.stringify(old)) return;
      this.settingsValue = value; this.showReflog = value.showReflog; this.density = value.density;
      this.settingsRevision++;
      if (this.snapshot || this.loading) void this.load(false, old.showReflog === value.showReflog);
    });
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
    this.settingsListener.dispose();
    this.watcher?.dispose();
    this.gitStateWatcher?.dispose();
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
    else if (message.type === 'openSettings') await openSettings(this.context, this.repositoryRoot);
    else if (message.type === 'loadMore') await this.loadMore();
    else if (message.type === 'select') await this.select(message.oid);
    else if (message.type === 'selectEvent') await this.selectEvent(message.id);
    else if (message.type === 'toggleReflog') {
      await this.settings.save('showReflog', message.enabled, this.repositoryRoot);
    } else if (message.type === 'setDensity') {
      await this.settings.save('density', message.density, this.repositoryRoot);
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
    const settingsRevision = this.settingsRevision;
    const settingsValue = this.settingsValue;
    try {
      const next = reuseSnapshot && this.snapshot ? this.snapshot : await this.client.readSnapshot(this.repositoryRoot, this.commitLimit, this.showReflog);
      if (this.disposed) return;
      if (settingsRevision !== this.settingsRevision) {
        // A presentation change must not discard newly-read Git state and
        // then render an older cached snapshot as the final result.
        if (!reuseSnapshot) this.pendingReload = true;
        return;
      }
      this.snapshot = next;
      if (!reuseSnapshot) { this.protectionLogs = undefined; this.routeEvidence = undefined; }
      const fixedDefault = settingsValue.layoutMode === 'default-fixed' ? resolveDefaultBranch(next.refs, settingsValue.fixedBranch) : undefined;
      // Both modes preserve FF source routes, independently of Reflog visibility.
      this.protectionLogs ??= await this.client.readBranchProtection(next);
      this.routeEvidence ??= await this.client.readRouteContinuityEvidence(next, this.protectionLogs);
      if (this.disposed || settingsRevision !== this.settingsRevision) return;
      if (!this.watcher) {
        this.watcher = new RepositoryWatcher(next.repository.gitDir, {
          commonGitDir: next.repository.commonGitDir,
          onChange: (reason) => {
            this.output.appendLine(`watch ${reason}`);
            void this.load(false);
          },
        });
        this.gitStateWatcher = new GitStateWatcher([next.repository.root, ...next.workingTrees.map((tree) => tree.path)],
          () => this.watcher?.notifyChange('git-state'));
      }
      const primaryBranch = vscode.workspace.getConfiguration('branchGraph').get<string | null>('primaryBranch', null);
      const factsStart = performance.now();
      const facts = buildGraphFacts(next, { showReflog: this.showReflog, primaryBranch });
      this.output.appendLine(`perf request=${requestId} factsMs=${(performance.now() - factsStart).toFixed(1)}`);
      this.visibleEvents = new Map(facts.events.map((event) => [event.id, event]));
      const layoutStart = performance.now();
      const stateKey = `${settingsValue.layoutMode}:${fixedDefault?.refName ?? ''}`;
      const layoutState = this.layoutStates.get(stateKey) ?? new LayoutState();
      this.layoutStates.set(stateKey, layoutState);
      // Manual target changes must not retain an unbounded collection of states.
      if (this.layoutStates.size > 4) this.layoutStates.delete(this.layoutStates.keys().next().value!);
      const layout = createGraphLayout(facts, {
        visibleCommitCount: next.visibleCommitCount,
        hasMore: next.hasMore,
        primaryBranch: primaryBranch ?? undefined,
        previousRows: isAppend ? layoutState.rows : undefined,
        previousLanes: !fixedDefault && (isAppend || reuseSnapshot) ? layoutState.lanes : undefined,
        previousNodeLanes: !fixedDefault && (isAppend || reuseSnapshot) ? layoutState.nodeLanes : undefined,
        fixedDefault,
        protectionReflogs: this.protectionLogs,
        routeEvidenceCommits: this.routeEvidence,
        rowHeight: this.presentation === 'sidebar' ? 28 : this.density === 'compact' ? 30 : 38,
        laneWidth: this.presentation === 'sidebar' ? 22 : undefined,
      });
      layoutState.set(layout);
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
