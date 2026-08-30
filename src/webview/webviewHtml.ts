import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function getWebviewHtml(webview: vscode.Webview, extensionPath: string): string {
  const assetDirectory = path.join(extensionPath, 'dist', 'webview', 'assets');
  const files = fs.existsSync(assetDirectory) ? fs.readdirSync(assetDirectory) : [];
  const script = files.find((file) => file.endsWith('.js'));
  const styles = files.find((file) => file.endsWith('.css'));
  const scriptUri = script ? webview.asWebviewUri(vscode.Uri.file(path.join(assetDirectory, script))) : '';
  const styleUri = styles ? webview.asWebviewUri(vscode.Uri.file(path.join(assetDirectory, styles))) : '';
  const token = nonce();
  const fallback = script ? '' : '<p>Webview assets are not built. Run <code>pnpm build</code> and reopen the panel.</p>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${token}';" />
  ${styleUri ? `<link rel="stylesheet" href="${styleUri}" />` : ''}
  <title>Git Lines</title>
</head>
<body>
  <div id="root">${fallback}</div>
  ${script ? `<script type="module" nonce="${token}" src="${scriptUri}"></script>` : ''}
</body>
</html>`;
}
