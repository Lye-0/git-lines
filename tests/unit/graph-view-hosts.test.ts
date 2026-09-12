import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { RepositorySnapshot } from '../../src/git/gitTypes.js';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../../src/webview/messageProtocol.js';

const mock = vi.hoisted(() => ({
  folders: [{ name: 'a', uri: { fsPath: 'C:/a' } }],
  choices: [] as Array<number | undefined>,
  readSnapshot: vi.fn(), readCommitDetail: vi.fn(),
  pick: vi.fn(), info: vi.fn(), execute: vi.fn(),
  watchers: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
}));

function event<T>() {
  const listeners = new Set<(value: T) => unknown>();
  return {
    subscribe: (listener: (value: T) => unknown) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: async (value: T) => { await Promise.all([...listeners].map((fn) => fn(value))); },
    get size() { return listeners.size; },
  };
}

function webview() {
  const incoming = event<WebviewToExtensionMessage>();
  const messages: ExtensionToWebviewMessage[] = [];
  return {
    incoming, messages, html: '', options: {},
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
  ViewColumn: { Active: -1 },
  Uri: { joinPath: (...parts: unknown[]) => ({ fsPath: parts.join('/') }) },
  window: {
    createWebviewPanel: () => { const panel = host(); panels.push(panel); return panel; },
    createOutputChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() }),
    showQuickPick: (...args: unknown[]) => mock.pick(...args),
    showInformationMessage: mock.info,
  },
  workspace: {
    get workspaceFolders() { return mock.folders; },
    getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
  },
  commands: { executeCommand: mock.execute },
}));
vi.mock('../../src/git/gitClient.js', () => ({ GitClient: class {
  readSnapshot = mock.readSnapshot;
  readCommitDetail = mock.readCommitDetail;
} }));
vi.mock('../../src/repository/repositoryWatcher.js', () => ({ RepositoryWatcher: class {
  dispose = vi.fn();
  constructor() { mock.watchers.push(this); }
} }));
vi.mock('../../src/webview/webviewHtml.js', () => ({ getWebviewHtml: () => '<html>graph</html>' }));

import { openGraph } from '../../src/commands/openGraph.js';
import { GraphPanel } from '../../src/webview/graphPanel.js';
import { GraphViewProvider } from '../../src/webview/graphViewProvider.js';
import { GraphViewSession } from '../../src/webview/graphViewSession.js';

const context = () => ({ extensionUri: { fsPath: 'C:/extension' }, extensionPath: 'C:/extension', subscriptions: [] }) as unknown as vscode.ExtensionContext;
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
  vi.clearAllMocks();
  panels.length = 0;
  mock.watchers.length = 0;
  mock.folders = [{ name: 'a', uri: { fsPath: 'C:/a' } }];
  mock.choices = [];
  mock.pick.mockImplementation(async (items: unknown[]) => {
    const choice = mock.choices.shift();
    return choice === undefined ? undefined : items[choice];
  });
  mock.execute.mockResolvedValue(undefined);
  mock.readSnapshot.mockImplementation(async (root: string) => snapshot(root));
});
afterEach(() => { for (const panel of panels) panel.dispose(); });

describe('graph launch locations', () => {
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

describe('shared editor/panel graph session', () => {
  it('keeps graph semantics, Reflog, density, pagination and Detail messages in both hosts', async () => {
    mock.readSnapshot.mockImplementation(async (root: string) => ({ ...snapshot(root), hasMore: true }));
    const editor = GraphPanel.open(context(), 'C:/a');
    const provider = new GraphViewProvider(context());
    const view = host();
    provider.resolveWebviewView(viewOf(view));
    const surfaces = [panels[0].webview, view.webview];
    for (const surface of surfaces) {
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
    expect(surfaces[0].messages.filter((m) => m.type === 'graph')).toEqual(surfaces[1].messages.filter((m) => m.type === 'graph'));
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
