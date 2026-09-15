/** Capture-only extension entry. Never included in the Marketplace package. */
import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';
import { GraphViewSession } from '../../src/webview/graphViewSession.js';
import { graphSettings } from '../../src/settings/graphSettings.js';

interface CaptureCase { name: string; root: string; mode: 'legacy' | 'default-fixed'; fixedBranch?: string; showReflog?: boolean }
export function activate(context: vscode.ExtensionContext): void {
  const runDir = path.dirname(context.extensionPath);
  const cases: CaptureCase[] = JSON.parse(fs.readFileSync(path.join(runDir, 'cases.json'), 'utf8'));
  const viewportScript = fs.readFileSync(path.join(context.extensionPath, 'viewport.js'), 'utf8');
  let current: vscode.WebviewPanel | undefined;
  let busy = false;
  let lastRequest = '';
  const status = (value: object) => fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2));
  const prepare = async (index: number) => {
    if (busy) throw new Error('Capture is still loading');
    if (!Number.isInteger(index) || !cases[index]) throw new Error('Unknown capture case');
    busy = true;
    const item = cases[index];
    const started = Date.now();
    status({ state: 'loading', index, ...item });
    try {
      current?.dispose();
      const config = vscode.workspace.getConfiguration('branchGraph');
      await config.update('layoutMode', item.mode, vscode.ConfigurationTarget.Global);
      if (item.showReflog !== undefined) await config.update('showReflog', item.showReflog, vscode.ConfigurationTarget.Global);
      await graphSettings(context).setFixedBranch(item.root, item.fixedBranch);
      const label = `${item.name} — ${item.mode === 'legacy' ? 'Standard' : 'Default Fixed'}${item.showReflog === undefined ? '' : ` · Reflog ${item.showReflog ? 'On' : 'Off'}`}`;
      current = vscode.window.createWebviewPanel('gitLinesCapture', label, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      const panel = current;
      panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'capture-viewport') fs.writeFileSync(path.join(runDir, 'viewport.json'), JSON.stringify(message));
      });
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon-v1.png');
      // Subscribe before constructing the session: a fast webview can send ready immediately.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { listener.dispose(); reject(new Error('No rendered acknowledgement within 60s')); }, 60_000);
        const listener = panel.webview.onDidReceiveMessage((message) => {
          if (message.type !== 'rendered') return;
          clearTimeout(timeout); listener.dispose();
          status({ state: 'ready', index, ...item, label, requestId: message.requestId, elapsedMs: Date.now() - started, renderedAt: new Date().toISOString() });
          resolve();
        });
        // Keep production HTML/assets intact; add only a capture scroll/measurement hook.
        const webview = new Proxy(panel.webview, {
          get(target, key) { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; },
          set(target, key, value) {
            if (key === 'html') {
              const nonce = /nonce-([^']+)/.exec(value)?.[1];
              value = value.replace('<head>', `<head><script nonce="${nonce}">${viewportScript}</script>`);
            }
            return Reflect.set(target, key, value);
          },
        });
        const session = new GraphViewSession(context, webview, item.root);
        panel.onDidDispose(() => { session.dispose(); clearTimeout(timeout); listener.dispose(); reject(new Error('Capture panel closed')); });
      });
    } catch (error) {
      status({ state: 'error', index, ...item, error: String(error) });
    } finally { busy = false; }
  };
  context.subscriptions.push(vscode.commands.registerCommand('gitLinesCapture.prepare', prepare));
  // A bounded file mailbox lets the CLI call the same command without menu navigation.
  const timer = setInterval(() => {
    if (busy) return;
    try {
      const request = fs.readFileSync(path.join(runDir, 'request.json'), 'utf8');
      if (request === lastRequest) return;
      lastRequest = request;
      const { index, action, token, top, left } = JSON.parse(request);
      if (action === 'position') void current?.webview.postMessage({ type: 'capture-position', token, top, left });
      else void vscode.commands.executeCommand('gitLinesCapture.prepare', index);
    } catch { /* No complete request yet. */ }
  }, 250);
  context.subscriptions.push({ dispose: () => { clearInterval(timer); current?.dispose(); } });
}
