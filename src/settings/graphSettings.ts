import * as vscode from 'vscode';

export type LayoutMode = 'legacy' | 'default-fixed';
export interface GraphSettings { showReflog: boolean; density: 'compact' | 'comfortable'; layoutMode: LayoutMode; fixedBranch?: string }
const services = new WeakMap<vscode.ExtensionContext, GraphSettingsService>();
const targetKey = (root: string) => `fixedBranch:${process.platform === 'win32' ? root.toLowerCase() : root}`;

export function graphSettings(context: vscode.ExtensionContext): GraphSettingsService {
  let service = services.get(context);
  if (!service) { service = new GraphSettingsService(context); services.set(context, service); context.subscriptions.push(service); }
  return service;
}

export class GraphSettingsService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly listener: vscode.Disposable;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('branchGraph')) this.emitter.fire();
    });
  }
  read(root?: string): GraphSettings {
    const config = vscode.workspace.getConfiguration('branchGraph', root ? vscode.Uri.file(root) : undefined);
    return {
      showReflog: config.get<boolean>('showReflog', true) !== false,
      density: config.get<string>('density') === 'comfortable' ? 'comfortable' : 'compact',
      layoutMode: config.get<string>('layoutMode') === 'default-fixed' ? 'default-fixed' : 'legacy',
      fixedBranch: root ? this.context.workspaceState.get<string>(targetKey(root)) : undefined,
    };
  }
  scope(key: 'showReflog' | 'density' | 'layoutMode', root?: string): vscode.ConfigurationTarget {
    const value = vscode.workspace.getConfiguration('branchGraph', root ? vscode.Uri.file(root) : undefined).inspect(key);
    return value?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
      : value?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  }
  async save<K extends 'showReflog' | 'density' | 'layoutMode'>(key: K, value: GraphSettings[K], root?: string): Promise<void> {
    if (key === 'showReflog' ? typeof value !== 'boolean' : key === 'density' ? !['compact', 'comfortable'].includes(String(value)) : !['legacy', 'default-fixed'].includes(String(value))) throw new Error('Invalid graph setting');
    await vscode.workspace.getConfiguration('branchGraph', root ? vscode.Uri.file(root) : undefined).update(key, value, this.scope(key, root));
  }
  async setFixedBranch(root: string, ref?: string): Promise<void> {
    await this.context.workspaceState.update(targetKey(root), ref); this.emitter.fire();
  }
  dispose(): void { this.listener.dispose(); this.emitter.dispose(); }
}
