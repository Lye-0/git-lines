import * as vscode from 'vscode';
import { GraphPanel } from '../webview/graphPanel.js';
import type { GraphViewProvider } from '../webview/graphViewProvider.js';

export type GraphLocation = 'editor' | 'panel' | 'sidebar';

export async function openGraph(context: vscode.ExtensionContext, panel: GraphViewProvider, location?: GraphLocation, sidebar?: GraphViewProvider): Promise<void> {
  const destination = location ?? (await vscode.window.showQuickPick([
    { label: '$(layout) Open in Editor', description: 'メイン画面で開く', location: 'editor' as const },
    { label: '$(layout-panel) Open in Panel', description: '下部パネルで開く', location: 'panel' as const },
    { label: '$(layout-sidebar-left) Open in Sidebar', description: '左サイドバーで開く', location: 'sidebar' as const },
  ], { placeHolder: 'Git Lines — 表示先を選択', matchOnDescription: true }))?.location;
  if (!destination) return;

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) {
    void vscode.window.showInformationMessage('Open a Git repository folder in VS Code, then use Git Lines: Open.');
    return;
  }
  let root = folders[0].uri.fsPath;
  if (folders.length > 1) {
    const selected = await vscode.window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, root: folder.uri.fsPath })),
      { placeHolder: 'Select a repository workspace' },
    );
    if (!selected) return;
    root = selected.root;
  }
  if (destination === 'sidebar') await sidebar?.open(root);
  else if (destination === 'panel') await panel.open(root);
  else GraphPanel.open(context, root);
}
