import * as vscode from 'vscode';
import { GraphViewSession } from './graphViewSession.js';

/** Editor host. Git reading and messages are shared with the panel view. */
export class GraphPanel {
  public static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly session: GraphViewSession;

  private constructor(context: vscode.ExtensionContext, public readonly repositoryRoot: string) {
    this.panel = vscode.window.createWebviewPanel('branchGraph', 'Git Lines', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.session = new GraphViewSession(context, this.panel.webview, repositoryRoot);
    this.panel.onDidDispose(() => {
      this.session.dispose();
      if (GraphPanel.current === this) GraphPanel.current = undefined;
    }, undefined, context.subscriptions);
    context.subscriptions.push(this.panel);
    GraphPanel.current = this;
  }

  public static open(context: vscode.ExtensionContext, repositoryRoot: string): GraphPanel {
    if (GraphPanel.current?.repositoryRoot === repositoryRoot) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return GraphPanel.current;
    }
    GraphPanel.current?.panel.dispose();
    return new GraphPanel(context, repositoryRoot);
  }

  public get active(): boolean {
    return this.panel.active;
  }

  public refresh(): Promise<void> {
    return this.session.refresh();
  }
}
