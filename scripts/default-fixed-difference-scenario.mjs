import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// A remote default without a local counterpart is a real Auto-mode difference.
// Existing fixtures and Git configuration outside this new repo are untouched.
const root = path.resolve(process.argv[2] ?? '../test');
const id = '148-default-remote-only';
const repo = path.join(root, 'repos', id);
const remote = path.join(root, 'remotes', `${id}.git`);
const guide = path.join(root, 'docs/default-fixed-difference.md');
const report = path.join(root, 'default-fixed-difference-verification.json');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verify = process.argv.includes('--verify');
function git(cwd, args, env = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }).trim();
}
if (!verify) {
  for (const destination of [repo, remote, guide, report]) assert(!fs.existsSync(destination), `Already exists: ${destination}; use --verify.`);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
  for (const [key, value] of Object.entries({ 'user.name': 'Git Lines Scenario', 'user.email': 'scenario@example.invalid',
    'commit.gpgSign': 'false', 'core.logAllRefUpdates': 'true', 'gc.auto': '0', 'gc.reflogExpire': 'never', 'gc.reflogExpireUnreachable': 'never' })) git(repo, ['config', '--local', key, value]);
  let tick = 0;
  const start = Date.now() - 86400000;
  const run = (args) => { const date = new Date(start + tick++ * 60000).toISOString(); return git(repo, args, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }); };
  run(['commit', '--allow-empty', '-m', 'D0: shared base']);
  run(['switch', '-c', 'feature']);
  run(['commit', '--allow-empty', '-m', 'F1: feature first']);
  run(['commit', '--allow-empty', '-m', 'F2: feature second']);
  run(['switch', 'main']);
  run(['commit', '--allow-empty', '-m', 'D1: remote default first']);
  run(['commit', '--allow-empty', '-m', 'D2: remote default second']);
  fs.mkdirSync(path.dirname(remote), { recursive: true });
  git(root, ['clone', '--bare', repo, remote]);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['fetch', 'origin']);
  git(repo, ['remote', 'set-head', 'origin', '-a']);
  run(['switch', 'feature']);
  // Only the disposable local main ref is removed; origin/main and the bare
  // repository retain the complete default branch and its metadata.
  run(['branch', '-D', 'main']);
  fs.appendFileSync(path.join(repo, '.git/info/exclude'), '\n/SCENARIO.md\n');
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-mode-difference-'));
const bundle = path.join(temporary, 'model.cjs');
const results = [];
try {
  await build({ stdin: { contents: `export { GitClient } from './src/git/gitClient.ts';
    export { buildGraphFacts } from './src/model/graphBuilder.ts';
    export { createGraphLayout } from './src/layout/graphLayout.ts';
    export { resolveDefaultBranch } from './src/model/defaultBranchResolver.ts';`, resolveDir: project },
    outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { GitClient, buildGraphFacts, createGraphLayout, resolveDefaultBranch } = createRequire(import.meta.url)(bundle);
  assert.equal(git(repo, ['status', '--porcelain']), '');
  const client = new GitClient();
  for (const showReflog of [false, true]) {
    const snapshot = await client.readSnapshot(repo, 100, showReflog);
    assert(!snapshot.refs.some((r) => r.fullName === 'refs/heads/main'));
    const target = resolveDefaultBranch(snapshot.refs);
    assert.equal(target?.refName, 'refs/remotes/origin/main');
    const facts = buildGraphFacts(snapshot, { showReflog });
    const protectionReflogs = await client.readBranchProtection(snapshot);
    for (const [host, rowHeight, laneWidth] of [['sidebar', 28, 22], ['compact', 30, 34], ['comfortable', 38, 34]]) {
      const options = { visibleCommitCount: 100, hasMore: false, rowHeight, laneWidth, protectionReflogs };
      const standard = createGraphLayout(facts, options);
      const fixed = createGraphLayout(facts, { ...options, fixedDefault: target });
      const defaultNodes = snapshot.commits.filter((c) => /^D[12]:/.test(c.subject));
      const featureNodes = snapshot.commits.filter((c) => /^F[12]:/.test(c.subject));
      assert.equal(defaultNodes.length, 2); assert.equal(featureNodes.length, 2);
      const positions = [];
      for (const commit of [...defaultNodes, ...featureNodes]) {
        const before = standard.nodes.find((n) => n.kind === 'commit' && n.oid === commit.oid);
        const after = fixed.nodes.find((n) => n.kind === 'commit' && n.oid === commit.oid);
        if (commit.subject.startsWith('D')) { assert(before.lane > 0); assert.equal(after.lane, 0); }
        else { assert.equal(before.lane, 0); assert(after.lane > 0); }
        assert.equal(after.trackId, before.trackId, 'Route identity must survive mode switching');
        positions.push({ subject: commit.subject, standardLane: before.lane, fixedLane: after.lane });
      }
      assert.equal(standard.nodes.find((n) => n.kind === 'working-tree').lane, 0);
      assert(fixed.nodes.find((n) => n.kind === 'working-tree').lane > 0);
      assert.deepEqual(standard.edges, fixed.edges);
      assert.deepEqual(standard.nodes.map((n) => [n.id, n.row]), fixed.nodes.map((n) => [n.id, n.row]));
      results.push({ showReflog, host, positions });
      console.log(`PASS ${host} Reflog=${showReflog}: default right -> left; feature left -> right`);
    }
  }
} finally { if (fs.existsSync(bundle)) fs.unlinkSync(bundle); fs.rmdirSync(temporary); }
const text = `# 148: モードの表示差を確認\n\nローカルにはfeatureのみがあり、defaultのmainはorigin/mainとして取得済みのシナリオです。origin/HEADはmainを指します。remoteはローカルのbare repositoryで、外部通信はありません。\n\n## 操作\n\n1. repos/${id} をVS Codeで開き、Git Linesを表示。\n2. Settings → Default Branch = Auto。\n3. Layout = Standard と Default Fixed を切り替える。\n\n| 確認箇所 | Standard | Default Fixed |\n|---|---|---|\n| D1・D2 / origin/main（default） | 右列 | 左端 |\n| F1・F2 / feature | 左端 | 右列 |\n| Working Tree（feature） | 左端 | 右列 |\n\nStandardはローカルのmainがないため現在のfeatureを基準にします。Default Fixedはremoteのdefaultであるorigin/mainを左端へ固定します。作成元のtrack、コミットの親子関係、行順は変わりません。mainという名前のローカルbranchは、このケースでは意図的に存在しません。\n\n両Reflog状態×3表示寸法の6条件で、現在のコードによる実際の列移動を検証済みです。branchGraph.primaryBranchを個別指定している場合は既定値（null）に戻して比較してください。\n\n## 起動\n\n\`\`\`powershell\ncode --new-window --extensionDevelopmentPath="${project}" "${repo}"\n\`\`\`\n\n## 再検証\n\nGit Linesのルートから:\n\n\`\`\`powershell\nnode scripts/default-fixed-difference-scenario.mjs "${root}" --verify\n\`\`\`\n\n既存の140〜147と独立した追加セットです。既存setup/resetはrepos配下を消すため、このシナリオも消えます。作成コマンドは同名出力が存在すると停止し、上書き・削除しません。\n`;
fs.mkdirSync(path.dirname(guide), { recursive: true });
fs.writeFileSync(path.join(repo, 'SCENARIO.md'), text);
fs.writeFileSync(guide, text);
fs.writeFileSync(report, JSON.stringify({ verifiedAt: new Date().toISOString(), scenario: id, results }, null, 2) + '\n');
