import * as vscode from 'vscode';
import { GraphPanel } from '../webview/graphPanel.js';

export function openGraph(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const root = folder?.uri.fsPath ?? process.cwd();
  GraphPanel.open(context, root);
}
