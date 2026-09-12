import * as vscode from 'vscode';
import { GraphViewSession } from './graphViewSession.js';

/** Independent VS Code-owned sidebar or bottom-panel webview. */
export class GraphViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'branchGraph.panelView';
  public static readonly sidebarViewId = 'branchGraph.sidebarView';
  private view?: vscode.WebviewView;
  private session?: GraphViewSession;
  private repositoryRoot?: string;
  private viewDisposal?: vscode.Disposable;

  public constructor(private readonly context: vscode.ExtensionContext, private readonly location: 'panel' | 'sidebar' = 'panel') {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.clearView();
    this.view = view;
    // Opening the tab directly uses the active file's workspace, then the first folder.
    this.repositoryRoot ??= (vscode.window.activeTextEditor
      ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.fsPath
      : undefined) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.session = new GraphViewSession(this.context, view.webview, this.repositoryRoot, this.location === 'sidebar' ? 'sidebar' : 'standard');
    this.viewDisposal = view.onDidDispose(() => this.clearView());
  }

  public async open(repositoryRoot: string): Promise<void> {
    this.repositoryRoot = repositoryRoot;
    if (this.view && this.session?.repositoryRoot !== repositoryRoot) {
      this.session?.dispose();
      this.session = new GraphViewSession(this.context, this.view.webview, repositoryRoot, this.location === 'sidebar' ? 'sidebar' : 'standard');
    }
    // Focusing resolves the provider lazily when the tab has not been opened yet.
    await vscode.commands.executeCommand(`${this.location === 'sidebar' ? GraphViewProvider.sidebarViewId : GraphViewProvider.viewId}.focus`);
    this.view?.show(false);
  }

  public async refresh(): Promise<boolean> {
    if (!this.session) return false;
    await this.session.refresh();
    return true;
  }

  public get visible(): boolean { return this.view?.visible === true; }

  public dispose(): void {
    this.clearView();
  }

  private clearView(): void {
    this.viewDisposal?.dispose();
    this.viewDisposal = undefined;
    this.session?.dispose();
    this.session = undefined;
    this.view = undefined;
  }
}
