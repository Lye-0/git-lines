import * as vscode from 'vscode';
import { GraphPanel } from '../webview/graphPanel.js';

export async function openGraph(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  let root = folders[0]?.uri.fsPath ?? process.cwd();
  if (folders.length > 1) {
    const selected = await vscode.window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, root: folder.uri.fsPath })),
      { placeHolder: 'Select a repository workspace' },
    );
    if (!selected) return;
    root = selected.root;
  }
  GraphPanel.open(context, root);
}
