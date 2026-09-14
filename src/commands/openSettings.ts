import * as vscode from 'vscode';
import { graphSettings } from '../settings/graphSettings.js';
import { GitClient } from '../git/gitClient.js';
import { resolveDefaultBranch } from '../model/defaultBranchResolver.js';

export async function openSettings(context: vscode.ExtensionContext, repositoryRoot?: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = !repositoryRoot && folders.length > 1 ? await vscode.window.showQuickPick(folders.map((f) => ({ label: f.name, folder: f })), { placeHolder: 'Git Lines — 設定するリポジトリ' }).then((item) => item?.folder) : folders[0];
  if (!repositoryRoot && folders.length > 1 && !folder) return;
  const root = repositoryRoot ?? folder?.uri.fsPath;
  const service = graphSettings(context);
  let refs: Awaited<ReturnType<GitClient['readRefs']>> = [];
  if (root) { try { refs = await new GitClient().readRefs(root); } catch { /* User settings remain available without Git. */ } }
  const scope = (key: 'layoutMode' | 'showReflog' | 'density') => {
    const target = service.scope(key, root);
    return target === vscode.ConfigurationTarget.WorkspaceFolder ? 'フォルダー設定へ保存' : target === vscode.ConfigurationTarget.Workspace ? 'ワークスペース設定へ保存' : 'ユーザー設定へ保存';
  };
  while (true) {
    const value = service.read(root), target = resolveDefaultBranch(refs, value.fixedBranch);
    const selected = await vscode.window.showQuickPick([
      { label: '$(git-branch) レーン配置', description: value.layoutMode === 'legacy' ? '従来の配置' : 'デフォルト列を左端に固定', detail: scope('layoutMode'), key: 'layoutMode' },
      { label: '$(history) Reflog', description: value.showReflog ? 'ON' : 'OFF', detail: scope('showReflog'), key: 'showReflog' },
      { label: '$(list-flat) Density', description: value.density === 'compact' ? 'Compact' : 'Comfortable', detail: `メイン・下部パネル用 · ${scope('density')}`, key: 'density' },
      ...(root ? [{ label: '$(pin) 固定対象', description: target?.refName ?? '対象未指定', detail: value.fixedBranch ? 'このリポジトリ用の手動指定' : 'ローカルに保存されたremote HEADから自動判定', key: 'target' }] : []),
    ], { title: 'Git Lines — 設定', placeHolder: '変更する項目を選択 · Escで閉じる', matchOnDescription: true });
    if (!selected) return;
    try {
      if (selected.key === 'target' && root) {
        const choice = await vscode.window.showQuickPick([{ label: '自動判定', ref: undefined as string | undefined },
          ...refs.filter((r) => r.type === 'local' || r.type === 'remote').map((r) => ({ label: r.shortName, description: r.fullName, ref: r.fullName }))], { title: '固定対象 — このリポジトリに保存', placeHolder: '表示上の固定対象を選択' });
        if (choice) await service.setFixedBranch(root, choice.ref);
      } else if (selected.key === 'layoutMode') {
        const choice = await vscode.window.showQuickPick([
          { label: '従来の配置', description: value.layoutMode === 'legacy' ? '選択中' : '', mode: 'legacy' as const },
          { label: 'デフォルト列を左端に固定', description: value.layoutMode === 'default-fixed' ? '選択中' : '', detail: '他ブランチの履歴を別列に保ちます。Reflog OFFでも列の保護に記録を利用します。', mode: 'default-fixed' as const },
        ], { title: 'レーン配置' });
        if (choice) await service.save('layoutMode', choice.mode, root);
      } else if (selected.key === 'showReflog') {
        const choice = await vscode.window.showQuickPick([true, false].map((enabled) => ({ label: enabled ? 'ON' : 'OFF', description: value.showReflog === enabled ? '選択中' : '', enabled })), { title: 'Reflog' });
        if (choice) await service.save('showReflog', choice.enabled, root);
      } else if (selected.key === 'density') {
        const choice = await vscode.window.showQuickPick((['compact', 'comfortable'] as const).map((density) => ({ label: density === 'compact' ? 'Compact' : 'Comfortable', description: value.density === density ? '選択中' : '', density })), { title: 'Density — メイン・下部パネル用' });
        if (choice) await service.save('density', choice.density, root);
      }
    } catch (error) { await vscode.window.showErrorMessage(`Git Lines: 設定を保存できませんでした。${String(error)}`); }
  }
}
