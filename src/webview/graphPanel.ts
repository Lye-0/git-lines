import * as vscode from 'vscode';
import { GraphViewSession } from './graphViewSession.js';

/** Editor host. Git reading and messages are shared with the panel view. */
export class GraphPanel implements vscode.Disposable {
  public static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly session: GraphViewSession;
  private disposed = false;

  private constructor(context: vscode.ExtensionContext, public readonly repositoryRoot: string) {
    this.panel = vscode.window.createWebviewPanel('branchGraph', 'Git Lines', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon-v1.png');
    this.session = new GraphViewSession(context, this.panel.webview, repositoryRoot);
    this.panel.onDidDispose(() => this.dispose());
    context.subscriptions.push(this);
    GraphPanel.current = this;
  }

  public static open(context: vscode.ExtensionContext, repositoryRoot: string): GraphPanel {
    if (GraphPanel.current?.repositoryRoot === repositoryRoot) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return GraphPanel.current;
    }
    GraphPanel.current?.dispose();
    return new GraphPanel(context, repositoryRoot);
  }

  public get active(): boolean {
    return this.panel.active;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session.dispose();
    this.panel.dispose();
    if (GraphPanel.current === this) GraphPanel.current = undefined;
  }

  public refresh(): Promise<void> {
    return this.session.refresh();
  }
}
