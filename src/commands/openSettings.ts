import * as vscode from 'vscode';
import { graphSettings } from '../settings/graphSettings.js';
import { GitClient } from '../git/gitClient.js';
import { resolveDefaultBranch } from '../model/defaultBranchResolver.js';

// Both codicons occupy one icon slot, keeping option text aligned.
const optionLabel = (label: string, selected: boolean) => `$(${selected ? 'check' : 'blank'}) ${label}`;

export async function openSettings(context: vscode.ExtensionContext, repositoryRoot?: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder = !repositoryRoot && folders.length > 1 ? await vscode.window.showQuickPick(folders.map((f) => ({ label: f.name, folder: f })), { placeHolder: 'Repository' }).then((item) => item?.folder) : folders[0];
  if (!repositoryRoot && folders.length > 1 && !folder) return;
  const root = repositoryRoot ?? folder?.uri.fsPath;
  const service = graphSettings(context);
  let refs: Awaited<ReturnType<GitClient['readRefs']>> = [];
  if (root) { try { refs = await new GitClient().readRefs(root); } catch { /* User settings remain available without Git. */ } }
  const scope = (key: 'layoutMode' | 'showReflog' | 'density') => {
    const target = service.scope(key, root);
    return target === vscode.ConfigurationTarget.WorkspaceFolder ? 'Folder' : target === vscode.ConfigurationTarget.Workspace ? 'Workspace' : 'User';
  };
  while (true) {
    const value = service.read(root), target = resolveDefaultBranch(refs, value.fixedBranch);
    const branchLabel = value.fixedBranch
      ? refs.find((ref) => ref.fullName === value.fixedBranch)?.shortName ?? 'Unknown'
      : `Auto · ${target?.branch ?? 'Unknown'}`;
    const selected = await vscode.window.showQuickPick([
      { label: '$(git-branch) Layout', description: `= ${value.layoutMode === 'legacy' ? 'Standard' : 'Default Fixed'}`, detail: scope('layoutMode'), key: 'layoutMode' },
      { label: '$(history) Reflog', description: `= ${value.showReflog ? 'On' : 'Off'}`, detail: scope('showReflog'), key: 'showReflog' },
      { label: '$(list-flat) Density', description: `= ${value.density === 'compact' ? 'Compact' : 'Comfortable'}`, detail: `Editor / Panel · ${scope('density')}`, key: 'density' },
      ...(root ? [{ label: '$(pin) Default Branch', description: `= ${branchLabel}`, detail: 'Repository', key: 'target' }] : []),
    ], { title: 'Git Lines — Settings', placeHolder: 'Select a setting', matchOnDescription: true });
    if (!selected) return;
    try {
      if (selected.key === 'target' && root) {
        const choice = await vscode.window.showQuickPick([{ label: optionLabel('Auto', !value.fixedBranch), ref: undefined as string | undefined },
          ...refs.filter((r) => r.type === 'local' || r.type === 'remote').map((r) => ({ label: optionLabel(r.shortName, value.fixedBranch === r.fullName), description: r.fullName, ref: r.fullName }))], { title: 'Default Branch', placeHolder: 'Select a branch' });
        if (choice) await service.setFixedBranch(root, choice.ref);
      } else if (selected.key === 'layoutMode') {
        const choice = await vscode.window.showQuickPick([
          { label: optionLabel('Standard', value.layoutMode === 'legacy'), mode: 'legacy' as const },
          { label: optionLabel('Default Fixed', value.layoutMode === 'default-fixed'), mode: 'default-fixed' as const },
        ], { title: 'Layout' });
        if (choice) await service.save('layoutMode', choice.mode, root);
      } else if (selected.key === 'showReflog') {
        const choice = await vscode.window.showQuickPick([true, false].map((enabled) => ({ label: optionLabel(enabled ? 'On' : 'Off', value.showReflog === enabled), enabled })), { title: 'Reflog' });
        if (choice) await service.save('showReflog', choice.enabled, root);
      } else if (selected.key === 'density') {
        const choice = await vscode.window.showQuickPick((['compact', 'comfortable'] as const).map((density) => ({ label: optionLabel(density === 'compact' ? 'Compact' : 'Comfortable', value.density === density), density })), { title: 'Density — Editor / Panel' });
        if (choice) await service.save('density', choice.density, root);
      }
    } catch (error) { await vscode.window.showErrorMessage(`Git Lines: Could not save settings. ${String(error)}`); }
  }
}
