import * as vscode from 'vscode';
import { openGraph } from './commands/openGraph.js';
import { GraphPanel } from './webview/graphPanel.js';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('branchGraph.open', () => openGraph(context)),
    vscode.commands.registerCommand('branchGraph.refresh', async () => {
      if (GraphPanel.current) await GraphPanel.current.refresh();
      else openGraph(context);
    }),
  );
}

export function deactivate(): void {
  // VS Code disposes the panel and output channel through subscriptions.
}
