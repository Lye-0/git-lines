import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { RepositorySnapshot, ReflogEntry } from '../../src/git/gitTypes.js';
import { resolveHistoryEvents } from '../../src/model/historyEventResolver.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../src/webview/messageProtocol.js';

const mock = vi.hoisted(() => ({
  folders: [{ name: 'a', uri: { fsPath: 'C:/a' } }],
  choices: [] as Array<number | undefined>,
  density: undefined as 'comfortable' | 'compact' | undefined,
  showReflog: true,
  layoutMode: 'legacy',
  readSnapshot: vi.fn(), readCommitDetail: vi.fn(), clearCache: vi.fn(),
  readBranchProtection: vi.fn(),
  readRouteContinuityEvidence: vi.fn(),
  pick: vi.fn(), info: vi.fn(), execute: vi.fn(),
  watchers: [] as Array<{ dispose: ReturnType<typeof vi.fn>; onChange: (reason: string) => void }>,
}));

function event<T>() {
  const listeners = new Set<(value: T) => unknown>();
  return {
    subscribe: (listener: (value: T) => unknown) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: async (value: T) => { await Promise.all([...listeners].map((fn) => fn(value))); },
    clear: () => listeners.clear(),
    get size() { return listeners.size; },
  };
}

function webview() {
  const incoming = event<WebviewToExtensionMessage>();
  const messages: ExtensionToWebviewMessage[] = [];
  return {
    incoming, messages, html: '', options: {} as vscode.WebviewOptions,
    onDidReceiveMessage: incoming.subscribe,
    postMessage: vi.fn(async (message: ExtensionToWebviewMessage) => { messages.push(message); return true; }),
  };
}

function host() {
  const closed = event<void>();
  return {
    webview: webview(), closed, active: true,
    onDidDispose: closed.subscribe,
    dispose: vi.fn(() => { void closed.fire(); }),
    reveal: vi.fn(), show: vi.fn(),
  };
}

const panels: ReturnType<typeof host>[] = [];
vi.mock('vscode', () => ({
  EventEmitter: class { private events = event<void>(); event = this.events.subscribe; fire() { void this.events.fire(); } dispose() {} },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { Active: -1 },
  Uri: { file: (fsPath: string) => ({ fsPath }), joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }) },
  window: {
    createWebviewPanel: () => { const panel = host(); panels.push(panel); return panel; },
    createOutputChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
    showQuickPick: (...args: unknown[]) => mock.pick(...args),
    showInformationMessage: mock.info,
  },
  workspace: {
    get workspaceFolders() { return mock.folders; },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration: () => boolean }) => unknown) => configuration.subscribe(listener),
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => key === 'density' ? mock.density ?? fallback : key === 'showReflog' ? mock.showReflog : key === 'layoutMode' ? mock.layoutMode : fallback,
      inspect: () => ({}),
      update: async (key: string, value: unknown) => {
        if (key === 'density') mock.density = value as typeof mock.density;
        if (key === 'showReflog') mock.showReflog = value as boolean;
        if (key === 'layoutMode') mock.layoutMode = value as string;
        await configuration.fire({ affectsConfiguration: () => true });
        for (let i = 0; i < 30; i++) await Promise.resolve();
      },
    }),
  },
  commands: { executeCommand: mock.execute },
}));
vi.mock('../../src/git/gitClient.js', () => ({ GitClient: class {
  readSnapshot = mock.readSnapshot;
  readCommitDetail = mock.readCommitDetail;
  clearCache = mock.clearCache;
  readBranchProtection = mock.readBranchProtection;
  readRouteContinuityEvidence = mock.readRouteContinuityEvidence;
} }));
vi.mock('../../src/repository/repositoryWatcher.js', () => ({ RepositoryWatcher: class {
  dispose = vi.fn();
  onChange: (reason: string) => void;
  constructor(_dir: string, options: { onChange: (reason: string) => void }) { this.onChange = options.onChange; mock.watchers.push(this); }
} }));
vi.mock('../../src/webview/webviewHtml.js', () => ({ getWebviewHtml: () => '<html>graph</html>' }));
vi.mock('../../src/repository/gitStateWatcher.js', () => ({ GitStateWatcher: class { dispose = vi.fn(); } }));

import { openGraph } from '../../src/commands/openGraph.js';
import { GraphPanel } from '../../src/webview/graphPanel.js';
import { GraphViewProvider } from '../../src/webview/graphViewProvider.js';
import { GraphViewSession } from '../../src/webview/graphViewSession.js';
import { graphSettings } from '../../src/settings/graphSettings.js';

const configuration = event<{ affectsConfiguration: () => boolean }>();
const context = () => ({ extensionUri: { fsPath: 'C:/extension' }, extensionPath: 'C:/extension', subscriptions: [], workspaceState: { get: () => undefined, update: vi.fn() } }) as unknown as vscode.ExtensionContext;
const viewOf = (h: ReturnType<typeof host>) => h as unknown as vscode.WebviewView;
const webviewOf = (v: ReturnType<typeof webview>) => v as unknown as vscode.Webview;
const oid = (n: number) => String(n).repeat(40);
function snapshot(root = 'C:/a'): RepositorySnapshot {
  const commits = [[3, [1]], [2, [1]], [1, []]].map(([n, parents]) => ({
    oid: oid(n as number), parentOids: (parents as number[]).map(oid), subject: `Commit ${n}`,
    authorName: 'Test', committerName: 'Test', authorDate: Number(n), committerDate: Number(n),
  }));
  return {
    repository: { root, gitDir: `${root}/.git`, commonGitDir: `${root}/.git`, bare: false, shallow: false, linkedWorktree: false },
    commits, refs: [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid(3) }],
    workingTrees: [{ worktreeId: 'wt', path: root, headOid: oid(3), branch: 'main', detached: false, clean: true, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }],
    historyEvents: [{ id: 'amend', type: 'amend', fromOid: oid(2), toOid: oid(3), refName: 'refs/heads/main', subject: 'commit (amend): Commit 3', timestamp: 3 }],
    reflogs: [], operations: [], shallowBoundaryOids: [], visibleCommitCount: 3, hasMore: false,
  };
}

beforeEach(() => {
  configuration.clear();
  vi.clearAllMocks();
  panels.length = 0;
  mock.watchers.length = 0;
  mock.folders = [{ name: 'a', uri: { fsPath: 'C:/a' } }];
  mock.choices = [];
  mock.density = undefined;
  mock.showReflog = true;
  mock.layoutMode = 'legacy';
  mock.pick.mockImplementation(async (items: unknown[]) => {
    const choice = mock.choices.shift();
    return choice === undefined ? undefined : items[choice];
  });
  mock.execute.mockResolvedValue(undefined);
  mock.readSnapshot.mockImplementation(async (root: string) => snapshot(root));
  mock.readBranchProtection.mockResolvedValue([]);
  mock.readRouteContinuityEvidence.mockImplementation(async (snapshot: RepositorySnapshot) => snapshot.commits);
});
afterEach(() => { for (const panel of panels) panel.dispose(); });

it('uses fresh OFF evidence across toggles, refresh and repository changes, with no selectable hidden FF', async () => {
  mock.showReflog = false;
  const data = snapshot(); data.commits[0].parentOids = [oid(2)];
  data.refs.push({ fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid(3) });
  let logs: ReflogEntry[] = [
    { refName: 'refs/heads/main', selector: 'refs/heads/main@{0}', previousOid: oid(1), newOid: oid(3), subject: 'merge feature: Fast-forward', timestamp: 4 },
    { refName: 'refs/heads/main', selector: 'refs/heads/main@{1}', newOid: oid(1), subject: 'commit (initial): base', timestamp: 1 },
    { refName: 'refs/heads/feature', selector: 'refs/heads/feature@{0}', previousOid: oid(2), newOid: oid(3), subject: 'commit: two', timestamp: 3 },
    { refName: 'refs/heads/feature', selector: 'refs/heads/feature@{1}', previousOid: oid(1), newOid: oid(2), subject: 'commit: one', timestamp: 2 },
    { refName: 'refs/heads/feature', selector: 'refs/heads/feature@{2}', newOid: oid(1), subject: 'branch: Created from main', timestamp: 1 },
  ];
  mock.readSnapshot.mockImplementation(async (root: string, _limit: number, visible: boolean) => root === 'C:/a'
    ? { ...data, reflogs: visible ? logs : [], historyEvents: visible ? resolveHistoryEvents(logs, data.commits) : [] } : snapshot(root));
  mock.readBranchProtection.mockImplementation(async (s: RepositorySnapshot) => s.repository.root === 'C:/a' ? logs : []);
  const ctx = context(); GraphPanel.open(ctx, 'C:/a');
  const surface = panels.at(-1)!.webview;
  const latest = () => surface.messages.filter(m => m.type === 'graph').at(-1)!;
  await surface.incoming.fire({ type: 'ready' });
  const cold = latest().layout;
  expect(cold.branchIntegrationPaths).toHaveLength(2);
  expect(cold.nodes.some(n => n.event)).toBe(false);
  await graphSettings(ctx).save('showReflog', true, 'C:/a');
  await vi.waitFor(() => expect(latest().reflogEnabled).toBe(true));
  const eventId = latest().layout.nodes.find(n => n.kind === 'fast-forward-event')!.id;
  await surface.incoming.fire({ type: 'selectEvent', id: eventId });
  expect(surface.messages.at(-1)).toMatchObject({ type: 'detail', event: { id: eventId } });
  await graphSettings(ctx).save('showReflog', false, 'C:/a');
  await vi.waitFor(() => expect(latest().reflogEnabled).toBe(false));
  expect(latest().layout).toEqual(cold);
  expect(surface.messages).toContainEqual({ type: 'detail', detail: null, event: null });
  const count = surface.messages.length;
  await surface.incoming.fire({ type: 'selectEvent', id: eventId });
  expect(surface.messages).toHaveLength(count);
  logs = [];
  await GraphPanel.current!.refresh();
  expect(latest().layout.branchIntegrationPaths).toEqual([]);
  expect(mock.clearCache).toHaveBeenCalled();
  GraphPanel.open(ctx, 'C:/b');
  const other = panels.at(-1)!.webview;
  await other.incoming.fire({ type: 'ready' });
  expect(other.messages.filter(m => m.type === 'graph').at(-1)!.layout.branchIntegrationPaths).toEqual([]);
  expect(surface.incoming.size).toBe(0);
});

describe('graph launch locations', () => {
  it('lets automatic primary selection follow the source of the current branch', async () => {
    const data = snapshot();
    data.refs = [
      { fullName: 'refs/heads/z-root', shortName: 'z-root', type: 'local', oid: oid(3) },
      { fullName: 'refs/heads/a-child', shortName: 'a-child', type: 'local', oid: oid(2) },
    ];
    data.workingTrees[0].branch = 'a-child'; data.workingTrees[0].headOid = oid(2);
    data.historyEvents = [];
    mock.readSnapshot.mockResolvedValue(data);
    mock.readBranchProtection.mockResolvedValue([
      { refName: 'refs/heads/a-child', selector: 'refs/heads/a-child@{0}', newOid: oid(1), timestamp: 1, subject: 'branch: Created from z-root' },
    ]);
    const surface = webview(), session = new GraphViewSession(context(), webviewOf(surface), 'C:/a');
    await surface.incoming.fire({ type: 'ready' });
    const message = surface.messages.find((m) => m.type === 'graph');
    expect(message?.type).toBe('graph');
    if (message?.type === 'graph') {
      expect(message.layout.nodes.find((n) => n.oid === oid(3) && n.kind === 'commit')?.lane).toBe(0);
      expect(message.layout.nodes.find((n) => n.oid === oid(2) && n.kind === 'commit')?.lane).toBeGreaterThan(0);
    }
    session.dispose();
  });
  it('opens settings for the displayed repository without a repository picker or Git snapshot read', async () => {
    const ctx = context(), surface = webview();
    const session = new GraphViewSession(ctx, webviewOf(surface), 'C:/a');
    mock.folders.push({ name: 'b', uri: { fsPath: 'C:/b' } });
    mock.choices = [2, 1, undefined];
    await surface.incoming.fire({ type: 'openSettings' });
    expect(mock.density).toBe('comfortable');
    expect(panels).toHaveLength(0);
    expect(mock.readSnapshot).not.toHaveBeenCalled();
    expect(graphSettings(ctx).read('C:/a').density).toBe('comfortable');
    expect(mock.pick.mock.calls[0][1].title).toBe('Git Lines — Settings');
    expect(mock.pick.mock.calls[1][0].map((item: { label: string }) => item.label)).toEqual([
      '$(check) Compact', '$(blank) Comfortable',
    ]);
    expect(mock.pick.mock.calls[2][0][2].description).toBe('= Comfortable');
    session.dispose(); graphSettings(ctx).dispose();
  });
  it('cancels without opening a host or reading Git', async () => {
    const provider = new GraphViewProvider(context());
    await openGraph(context(), provider);
    expect(panels).toHaveLength(0);
    expect(mock.execute).not.toHaveBeenCalled();
    expect(mock.readSnapshot).not.toHaveBeenCalled();
  });

  it('selects the location then repository and resolves the panel lazily', async () => {
    mock.folders.push({ name: 'b', uri: { fsPath: 'C:/b' } });
    mock.choices = [1, 1];
    const provider = new GraphViewProvider(context());
    const view = host();
    mock.execute.mockImplementation(async () => provider.resolveWebviewView(viewOf(view)));
    await openGraph(context(), provider);
    await view.webview.incoming.fire({ type: 'ready' });
    expect(panels).toHaveLength(0);
    expect(mock.readSnapshot).toHaveBeenCalledWith('C:/b', 30, true);
    expect(mock.execute).toHaveBeenCalledWith('branchGraph.panelView.focus');
    provider.dispose();
  });

  it('cancels the repository picker and handles an empty workspace', async () => {
    const provider = new GraphViewProvider(context());
    mock.folders.push({ name: 'b', uri: { fsPath: 'C:/b' } });
    await openGraph(context(), provider, 'panel');
    expect(mock.execute).not.toHaveBeenCalled();
    mock.folders = [];
    await openGraph(context(), provider, 'editor');
    expect(mock.info).toHaveBeenCalledOnce();
    expect(panels).toHaveLength(0);
  });

  it('reuses an editor and releases the old session when the repository changes', async () => {
    const ctx = context();
    const first = GraphPanel.open(ctx, 'C:/a');
    await panels[0].webview.incoming.fire({ type: 'ready' });
    expect(GraphPanel.open(ctx, 'C:/a')).toBe(first);
    expect(panels).toHaveLength(1);
    expect(panels[0].reveal).toHaveBeenCalledOnce();
    GraphPanel.open(ctx, 'C:/b');
    expect(panels[0].dispose).toHaveBeenCalledOnce();
    expect(panels[0].webview.incoming.size).toBe(0);
    expect(mock.watchers[0].dispose).toHaveBeenCalledOnce();
  });

  it('reuses the panel document and its listener when reopening the same repository', async () => {
    const provider = new GraphViewProvider(context());
    const view = host();
    provider.resolveWebviewView(viewOf(view));
    await view.webview.incoming.fire({ type: 'ready' });
    await provider.open('C:/a');
    await provider.open('C:/a');
    expect(view.webview.incoming.size).toBe(1);
    expect(mock.readSnapshot).toHaveBeenCalledOnce();
    provider.dispose();
    expect(view.webview.incoming.size).toBe(0);
  });

  it('releases editor resources when VS Code disposes the extension context', async () => {
    const ctx = context();
    GraphPanel.open(ctx, 'C:/a');
    await panels[0].webview.incoming.fire({ type: 'ready' });
    for (const disposable of ctx.subscriptions) disposable.dispose();
    expect(panels[0].webview.incoming.size).toBe(0);
    expect(mock.watchers[0].dispose).toHaveBeenCalledOnce();
    expect(GraphPanel.current).toBeUndefined();
  });

  it('discards an old pending snapshot after a panel repository switch', async () => {
    const provider = new GraphViewProvider(context());
    const view = host();
    let finishOld!: (value: RepositorySnapshot) => void;
    mock.readSnapshot.mockImplementationOnce(() => new Promise<RepositorySnapshot>((resolve) => { finishOld = resolve; }));
    provider.resolveWebviewView(viewOf(view));
    const pending = view.webview.incoming.fire({ type: 'ready' });
    await vi.waitFor(() => expect(mock.readSnapshot).toHaveBeenCalledOnce());
    await provider.open('C:/b');
    await view.webview.incoming.fire({ type: 'ready' });
    finishOld(snapshot('C:/a'));
    await pending;
    const graphs = view.webview.messages.filter((m) => m.type === 'graph');
    expect(graphs.map((m) => m.repository.root)).toEqual(['C:/b']);
    expect(mock.watchers).toHaveLength(1);
    expect(view.webview.incoming.size).toBe(1);
    provider.dispose();
  });

  it('releases a disposed panel view and creates a working replacement', async () => {
    const provider = new GraphViewProvider(context());
    const first = host();
    provider.resolveWebviewView(viewOf(first));
    await first.webview.incoming.fire({ type: 'ready' });
    await first.closed.fire();
    expect(first.webview.incoming.size).toBe(0);
    expect(await provider.refresh()).toBe(false);
    const second = host();
    provider.resolveWebviewView(viewOf(second));
    await second.webview.incoming.fire({ type: 'ready' });
    expect(second.webview.messages.some((m) => m.type === 'graph')).toBe(true);
    provider.dispose();
  });
});

describe('settings updates in live sessions', () => {
  it('reuses display data, obtains protection once with Reflog off, and restores legacy placement', async () => {
    mock.showReflog = false;
    mock.readSnapshot.mockImplementation(async () => {
      const data = snapshot();
      data.refs.push({ fullName: 'refs/remotes/origin/HEAD', shortName: 'origin/HEAD', type: 'symbolic', targetRef: 'refs/remotes/origin/main' });
      return data;
    });
    const ctx = context(), service = graphSettings(ctx);
    const surface = webview(), second = webview();
    const session = new GraphViewSession(ctx, webviewOf(surface), 'C:/a');
    const sidebar = new GraphViewSession(ctx, webviewOf(second), 'C:/a', 'sidebar');
    await surface.incoming.fire({ type: 'ready' }); await second.incoming.fire({ type: 'ready' });
    const before = surface.messages.filter((m) => m.type === 'graph').at(-1)!.layout;
    mock.readSnapshot.mockClear();
    await service.save('layoutMode', 'default-fixed', 'C:/a');
    await vi.waitFor(() => expect(mock.readBranchProtection).toHaveBeenCalledTimes(2));
    await service.save('density', 'comfortable', 'C:/a');
    await vi.waitFor(() => expect(surface.messages.filter((m) => m.type === 'graph').at(-1)!.density).toBe('comfortable'));
    expect(second.messages.filter((m) => m.type === 'graph').at(-1)!.layout.rowHeight).toBe(28);
    expect(mock.readBranchProtection).toHaveBeenCalledTimes(2);
    expect(mock.readSnapshot).not.toHaveBeenCalled();
    await service.save('density', 'compact', 'C:/a');
    await service.save('layoutMode', 'legacy', 'C:/a');
    await vi.waitFor(() => expect(surface.messages.filter((m) => m.type === 'graph').at(-1)!.layout).toEqual(before));
    session.dispose(); sidebar.dispose(); service.dispose();
  });
});

describe('shared editor/panel graph session', () => {
  it('respects an explicitly configured Comfortable density', async () => {
    mock.density = 'comfortable';
    const surface = webview();
    const session = new GraphViewSession(context(), webviewOf(surface), 'C:/a');
    await surface.incoming.fire({ type: 'ready' });
    expect(surface.messages.find((message) => message.type === 'graph')).toMatchObject({ density: 'comfortable', layout: { rowHeight: 38 } });
    session.dispose();
  });
  it('opens an independent sidebar view with compact presentation', async () => {
    const sidebar = new GraphViewProvider(context(), 'sidebar');
    const view = host();
    sidebar.resolveWebviewView(viewOf(view));
    await sidebar.open('C:/a');
    expect(mock.execute).toHaveBeenCalledWith('branchGraph.sidebarView.focus');
    await view.webview.incoming.fire({ type: 'ready' });
    expect(view.webview.messages.find((message) => message.type === 'graph')).toMatchObject({ presentation: 'sidebar', layout: { rowHeight: 28, laneWidth: 22 } });
    const panel = new GraphViewProvider(context());
    const bottom = host();
    panel.resolveWebviewView(viewOf(bottom));
    await bottom.webview.incoming.fire({ type: 'ready' });
    expect(bottom.webview.messages.find((message) => message.type === 'graph')).toMatchObject({ presentation: 'standard', density: 'compact', layout: { rowHeight: 30, laneWidth: 34 } });
    sidebar.dispose();
    panel.dispose();
  });

  it('routes the sidebar command to its provider', async () => {
    const panel = new GraphViewProvider(context());
    const sidebar = new GraphViewProvider(context(), 'sidebar');
    await openGraph(context(), panel, 'sidebar', sidebar);
    expect(mock.execute).toHaveBeenCalledWith('branchGraph.sidebarView.focus');
    expect(panels).toHaveLength(0);
    panel.dispose(); sidebar.dispose();
  });
  it('changes density without Git reads or clearing Detail', async () => {
    mock.density = 'comfortable';
    const surface = webview();
    const session = new GraphViewSession(context(), webviewOf(surface), 'C:/a');
    await surface.incoming.fire({ type: 'ready' });
    mock.readSnapshot.mockClear();
    surface.messages.length = 0;
    await surface.incoming.fire({ type: 'setDensity', density: 'compact' });
    expect(mock.readSnapshot).not.toHaveBeenCalled();
    expect(surface.messages.find((message) => message.type === 'graph')).toMatchObject({ density: 'compact', layout: { rowHeight: 30 } });
    expect(surface.messages.some((message) => message.type === 'detail')).toBe(false);
    session.dispose();
  });

  it('coalesces watcher changes during a read and retains the final update', async () => {
    const surface = webview();
    const session = new GraphViewSession(context(), webviewOf(surface), 'C:/a');
    await surface.incoming.fire({ type: 'ready' });
    let complete!: (snapshot: RepositorySnapshot) => void;
    mock.readSnapshot.mockImplementationOnce(() => new Promise<RepositorySnapshot>((resolve) => { complete = resolve; }));
    const refresh = session.refresh();
    await vi.waitFor(() => expect(complete).toBeDefined());
    mock.watchers[0].onChange('refs/heads/main');
    mock.watchers[0].onChange('logs/HEAD');
    await surface.incoming.fire({ type: 'setDensity', density: 'compact' });
    complete(snapshot());
    await refresh;
    expect(mock.readSnapshot).toHaveBeenCalledTimes(3);
    expect(surface.messages.filter((message) => message.type === 'graph').at(-1)).toMatchObject({ density: 'compact' });
    session.dispose();
  });

  it('defers forced cache invalidation until a pending read finishes', async () => {
    const surface = webview();
    const session = new GraphViewSession(context(), webviewOf(surface), 'C:/a');
    let complete!: (snapshot: RepositorySnapshot) => void;
    mock.readSnapshot.mockImplementationOnce(() => new Promise<RepositorySnapshot>((resolve) => { complete = resolve; }));
    const ready = surface.incoming.fire({ type: 'ready' });
    await vi.waitFor(() => expect(complete).toBeDefined());
    await session.refresh();
    expect(mock.clearCache).not.toHaveBeenCalled();
    complete(snapshot());
    await ready;
    expect(mock.clearCache).toHaveBeenCalledTimes(1);
    expect(mock.readSnapshot).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('keeps graph semantics, Reflog, density, pagination and Detail messages in both hosts', async () => {
    mock.readSnapshot.mockImplementation(async (root: string) => ({ ...snapshot(root), hasMore: true }));
    const editor = GraphPanel.open(context(), 'C:/a');
    const provider = new GraphViewProvider(context());
    const view = host();
    provider.resolveWebviewView(viewOf(view));
    const surfaces = [panels[0].webview, view.webview];
    for (const surface of surfaces) await surface.incoming.fire({ type: 'ready' });
    for (const surface of surfaces) {
      expect(surface.options.localResourceRoots).toEqual([
        { fsPath: 'C:/extension/dist/webview' },
        { fsPath: 'C:/extension/resources' },
      ]);
      await surface.incoming.fire({ type: 'ready' });
      const graph = surface.messages.find((m) => m.type === 'graph');
      expect(graph?.layout.historyRelations).toHaveLength(1);
      await surface.incoming.fire({ type: 'toggleReflog', enabled: false });
      await surface.incoming.fire({ type: 'setDensity', density: 'compact' });
      await surface.incoming.fire({ type: 'loadMore' });
      expect(mock.readSnapshot).toHaveBeenLastCalledWith('C:/a', 40, false);
      const latest = surface.messages.filter((m) => m.type === 'graph').at(-1)!;
      expect(latest.layout.historyRelations).toEqual([]);
      expect(latest.layout.nodes.some((n) => n.kind === 'reflog-commit')).toBe(false);
      expect(latest.layout.rowHeight).toBe(30);
      const detail = { ...snapshot().commits[0], files: [] };
      mock.readCommitDetail.mockResolvedValue(detail);
      await surface.incoming.fire({ type: 'select', oid: oid(3) });
      expect(surface.messages.at(-1)).toEqual({ type: 'detail', detail, event: null });
    }
    const finalGraphs = surfaces.map((surface) => {
      const { requestId: _requestId, ...graph } = surface.messages.filter((m) => m.type === 'graph').at(-1)!;
      return graph;
    });
    expect(finalGraphs[0]).toEqual(finalGraphs[1]);
    await editor.refresh();
    provider.dispose();
  });

  it('shows an empty-workspace message without reading process.cwd as a repository', async () => {
    const surface = webview();
    const session = new GraphViewSession(context(), webviewOf(surface), undefined);
    await surface.incoming.fire({ type: 'ready' });
    expect(mock.readSnapshot).not.toHaveBeenCalled();
    expect(surface.messages).toEqual([expect.objectContaining({ type: 'error', title: 'Open a repository folder' })]);
    session.dispose();
  });
});
