import * as vscode from 'vscode';
import { openGraph } from './commands/openGraph.js';
import { GraphPanel } from './webview/graphPanel.js';
import { GraphViewProvider } from './webview/graphViewProvider.js';

export function activate(context: vscode.ExtensionContext): void {
  const panel = new GraphViewProvider(context);
  const launcher = vscode.window.createStatusBarItem('gitLines.open', vscode.StatusBarAlignment.Left, 40);
  launcher.name = 'Git Lines';
  launcher.text = 'Git Lines';
  launcher.tooltip = 'Open Git Lines in the editor or bottom panel';
  launcher.accessibilityInformation = { label: 'Git Lines: choose editor or panel' };
  launcher.command = 'branchGraph.open';
  const updateLauncher = () => {
    if (vscode.workspace.workspaceFolders?.length) launcher.show();
    else launcher.hide();
  };
  updateLauncher();
  context.subscriptions.push(
    panel,
    launcher,
    vscode.workspace.onDidChangeWorkspaceFolders(updateLauncher),
    vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('branchGraph.open', () => openGraph(context, panel)),
    vscode.commands.registerCommand('branchGraph.openEditor', () => openGraph(context, panel, 'editor')),
    vscode.commands.registerCommand('branchGraph.openPanel', () => openGraph(context, panel, 'panel')),
    vscode.commands.registerCommand('branchGraph.refresh', async () => {
      if (GraphPanel.current?.active) await GraphPanel.current.refresh();
      else if (await panel.refresh()) return;
      else if (GraphPanel.current) await GraphPanel.current.refresh();
      else await openGraph(context, panel);
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes hosts, message listeners and watchers through subscriptions.
}
