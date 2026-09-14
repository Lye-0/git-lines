import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
const mock = vi.hoisted(() => ({ values: new Map<string, unknown>(), overrides: {} as Record<string, unknown>, update: vi.fn(), listeners: new Set<(e: { affectsConfiguration: (name: string) => boolean }) => void>() }));
vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  EventEmitter: class {
    listeners = new Set<() => void>();
    event = (fn: () => void) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
    fire() { for (const fn of this.listeners) fn(); }
    dispose() { this.listeners.clear(); }
  },
  workspace: {
    onDidChangeConfiguration: (fn: (e: { affectsConfiguration: (name: string) => boolean }) => void) => { mock.listeners.add(fn); return { dispose: () => mock.listeners.delete(fn) }; },
    getConfiguration: () => ({ get: (key: string, fallback: unknown) => mock.values.get(key) ?? fallback, inspect: () => mock.overrides, update: mock.update }),
  },
}));
import { GraphSettingsService } from '../../src/settings/graphSettings.js';

function context(store = new Map<string, unknown>()): vscode.ExtensionContext {
  return { workspaceState: { get: (key: string) => store.get(key), update: async (key: string, value: unknown) => { store.set(key, value); } } } as unknown as vscode.ExtensionContext;
}
beforeEach(() => {
  mock.values.clear(); mock.listeners.clear(); mock.overrides = {}; mock.update.mockReset();
  mock.update.mockImplementation(async (key: string, value: unknown) => { mock.values.set(key, value); for (const fn of mock.listeners) fn({ affectsConfiguration: (name) => name === 'branchGraph' }); });
});
describe('persistent graph settings', () => {
  it('restores values across service creation and emits changes to active views', async () => {
    const store = new Map<string, unknown>(), first = new GraphSettingsService(context(store)), changes = vi.fn();
    first.onDidChange(changes);
    await first.save('layoutMode', 'default-fixed', '/repo');
    await first.save('showReflog', false, '/repo');
    await first.save('density', 'comfortable', '/repo');
    await first.setFixedBranch('/repo', 'refs/heads/trunk');
    expect(changes).toHaveBeenCalledTimes(4);
    first.dispose();
    const restored = new GraphSettingsService(context(store));
    expect(restored.read('/repo')).toEqual({ layoutMode: 'default-fixed', showReflog: false, density: 'comfortable', fixedBranch: 'refs/heads/trunk' });
    expect(restored.read('/other').fixedBranch).toBeUndefined();
    restored.dispose(); expect(mock.listeners.size).toBe(0);
  });
  it('writes to the effective scope and reports failures without changing stored values', async () => {
    const service = new GraphSettingsService(context());
    await service.save('density', 'comfortable'); expect(mock.update).toHaveBeenLastCalledWith('density', 'comfortable', 1);
    mock.overrides = { workspaceValue: 'compact' };
    await service.save('density', 'compact'); expect(mock.update).toHaveBeenLastCalledWith('density', 'compact', 2);
    mock.overrides = { workspaceFolderValue: 'compact' };
    await service.save('density', 'compact', '/repo'); expect(mock.update).toHaveBeenLastCalledWith('density', 'compact', 3);
    mock.update.mockRejectedValueOnce(new Error('Read-only settings'));
    await expect(service.save('density', 'comfortable', '/repo')).rejects.toThrow('Read-only');
    expect(service.read('/repo').density).toBe('compact'); service.dispose();
  });
  it('validates values and leaves invalid persisted enums at safe defaults', async () => {
    mock.values.set('density', 'invalid'); mock.values.set('layoutMode', 'invalid');
    const service = new GraphSettingsService(context());
    expect(service.read()).toMatchObject({ density: 'compact', layoutMode: 'legacy' });
    await expect(service.save('density', 'invalid' as 'compact')).rejects.toThrow('Invalid');
    expect(mock.update).not.toHaveBeenCalled(); service.dispose();
  });
});
