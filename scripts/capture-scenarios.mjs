import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action = 'prepare', arg, number] = process.argv.slice(2);
const run = path.resolve(arg ?? path.join(project, 'artifacts', 'capture-01-03'));
if (action === 'select') {
  const cases = JSON.parse(await fs.readFile(path.join(run, 'cases.json'), 'utf8'));
  const index = Number(number);
  if (!Number.isInteger(index) || !cases[index]) throw new Error(`Use a case index from 0 through ${cases.length - 1}`);
  const request = JSON.stringify({ id: randomUUID(), index });
  const started = Date.now();
  await fs.writeFile(path.join(run, 'request.next.json'), request);
  await fs.rename(path.join(run, 'request.next.json'), path.join(run, 'request.json'));
  for (;;) {
    let status;
    try { status = JSON.parse(await fs.readFile(path.join(run, 'status.json'), 'utf8')); } catch {}
    if (status?.index === index && status.state === 'ready' && Date.parse(status.renderedAt) >= started) { console.log(status); break; }
    if (status?.index === index && status.state === 'error' && Date.parse(status.updatedAt) >= started) throw new Error(status.error);
    if (Date.now() - started > 65_000) throw new Error('Capture host did not acknowledge the request');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
} else if (action === 'prepare') {
  // Refuse to overwrite a prior experiment or its screenshots/profile.
  await fs.mkdir(path.dirname(run), { recursive: true });
  await fs.mkdir(run, { recursive: false });
  const stage = path.join(run, 'extension');
  await fs.mkdir(stage);
  const fixtureRoot = path.resolve(project, '..', 'test', 'repos');
  const names = number === '--all' ? (await fs.readdir(fixtureRoot, { withFileTypes: true })).filter(e => e.isDirectory() && /^\d+-/.test(e.name)).map(e => e.name).sort((a,b) => parseInt(a)-parseInt(b)) : ['01-linear', '02-initial-only', '03-empty-commit'];
  const cases = names.flatMap(name => {
    const root = path.join(fixtureRoot, name);
    const refs = execFileSync('git', ['-C', root, 'for-each-ref', '--format=%(refname) %(symref)'], { encoding: 'utf8' }).trim().split(/\r?\n/).map(line => line.split(' '));
    const remoteDefault = refs.find(([ref]) => ref === 'refs/remotes/origin/HEAD')?.[1];
    const localDefault = remoteDefault?.replace(/^refs\/remotes\/[^/]+\//, 'refs/heads/');
    const fixedBranch = remoteDefault ? (refs.some(([ref]) => ref === localDefault) ? localDefault : remoteDefault) : refs.find(([ref]) => ref === 'refs/heads/main')?.[0];
    return ['legacy', 'default-fixed'].map(mode => ({ name, root, mode, fixedBranch }));
  });
  for (const item of cases) await fs.access(path.join(item.root, '.git'));
  await fs.writeFile(path.join(run, 'cases.json'), JSON.stringify(cases, null, 2));
  const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  manifest.name = 'git-lines-capture';
  manifest.displayName = 'Git Lines Capture Experiment';
  manifest.activationEvents = ['onStartupFinished'];
  manifest.main = './extension.cjs';
  manifest.contributes = { configuration: manifest.contributes.configuration, commands: [{ command: 'gitLinesCapture.prepare', title: 'Git Lines Capture: Prepare Case' }] };
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
  await fs.cp(path.join(project, 'dist', 'webview'), path.join(stage, 'dist', 'webview'), { recursive: true });
  await fs.cp(path.join(project, 'resources'), path.join(stage, 'resources'), { recursive: true });
  await fs.copyFile(path.join(project, 'scripts/capture/viewport.js'), path.join(stage, 'viewport.js'));
  await build({ entryPoints: [path.join(project, 'scripts', 'capture', 'extension.ts')], bundle: true, platform: 'node', target: 'node20', format: 'cjs', outfile: path.join(stage, 'extension.cjs'), external: ['vscode'] });
  const user = path.join(run, 'profile', 'User');
  await fs.mkdir(user, { recursive: true });
  await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({
    'window.title': number === '--all' ? 'Git Lines Capture All Scenarios' : 'Git Lines Capture 01–03',
    'window.newWindowDimensions': 'maximized',
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.activityBar.location': 'hidden',
    'workbench.statusBar.visible': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'window.zoomLevel': 2,
    'git.enabled': false,
    'branchGraph.initialCommitCount': 10000,
    'branchGraph.showReflog': true,
    'branchGraph.density': 'compact',
  }, null, 2));
  await fs.mkdir(path.join(run, 'images'));
  await fs.writeFile(path.join(run, 'request.json'), JSON.stringify({ id: randomUUID(), index: 0 }));
  console.log(`Prepared ${run}\nLaunch VS Code with --extensionDevelopmentPath="${stage}" --user-data-dir="${path.join(run, 'profile')}" --extensions-dir="${path.join(run, 'extensions')}" --new-window`);
} else if (action === 'gallery') {
  console.log(await (await import('./capture/gallery.mjs')).gallery(run));
} else throw new Error('Use prepare, select, or gallery');
