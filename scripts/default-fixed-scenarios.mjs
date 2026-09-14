import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Additive fixtures only: never reset or overwrite existing repositories.
// node scripts/default-fixed-scenarios.mjs <scenario-root> [--verify]
const root = path.resolve(process.argv[2] ?? '../test');
const verifyOnly = process.argv.includes('--verify');
const manifestPath = path.join(root, 'default-fixed-manifest.json');
const guidePath = path.join(root, 'docs/default-fixed.md');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const definitions = [
  ['140-default-checkout-only', 'ブランチ移動のみ・コミット未作成', 'checkout'],
  ['141-default-fast-forward', 'mainが進んでいない状態でfeatureをfast-forward', 'ff'],
  ['142-default-deleted-feature', 'fast-forward後にfeature参照を削除', 'deleted'],
  ['143-default-main-continues', 'feature参照削除後にmainでコミット', 'continued'],
  ['144-default-merge-into-main', 'main ← feature の通常マージ', 'into-main'],
  ['145-default-merge-into-feature', 'main → feature の通常マージ', 'into-feature'],
  ['146-default-octopus', 'mainに3本のブランチをマージ', 'octopus'],
  ['147-default-trunk', 'defaultがtrunk・mainも存在', 'trunk'],
];
function git(cwd, args, env = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  }).trim();
}

if (!verifyOnly) {
  // Check every destination before creating any scenario. No destructive retry path.
  for (const destination of [manifestPath, guidePath, path.join(root, 'default-fixed-verification.json'), ...definitions.flatMap(([id]) =>
    [path.join(root, 'repos', id), path.join(root, 'remotes', `${id}.git`)])]) {
    assert(!fs.existsSync(destination), `Already exists: ${destination}. Use --verify to inspect existing fixtures.`);
  }
  const scenarios = [];
  for (const [id, title, kind] of definitions) {
    const repo = path.join(root, 'repos', id), remote = path.join(root, 'remotes', `${id}.git`);
    const defaultBranch = kind === 'trunk' ? 'trunk' : 'main';
    fs.mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-b', defaultBranch]);
    for (const [key, value] of Object.entries({ 'user.name': 'Git Lines Scenario', 'user.email': 'scenario@example.invalid',
      'commit.gpgSign': 'false', 'core.logAllRefUpdates': 'true', 'gc.auto': '0', 'gc.reflogExpire': 'never', 'gc.reflogExpireUnreachable': 'never' })) {
      git(repo, ['config', '--local', key, value]);
    }
    let tick = 0;
    const start = Date.now() - 86400000;
    const command = (args) => { const date = new Date(start + tick++ * 60000).toISOString(); return git(repo, args, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }); };
    const commit = (label) => { command(['commit', '--allow-empty', '-m', label]); return git(repo, ['rev-parse', 'HEAD']); };
    const base = commit('D0: default base');
    const protectedOids = [];
    const defaultOids = [];
    let mergeOid;
    let mergeParents = 0;
    let workingLane = 'default';
    if (kind === 'checkout') {
      command(['switch', '-c', 'feature']);
      workingLane = 'other';
    } else if (kind === 'octopus') {
      for (const name of ['feature-a', 'feature-b', 'feature-c']) {
        command(['switch', '-c', name, defaultBranch]);
        protectedOids.push(commit(`${name}: independent commit`));
      }
      command(['switch', defaultBranch]);
      defaultOids.push(commit('D1: default advances'));
      command(['merge', '--no-ff', 'feature-a', 'feature-b', 'feature-c', '-m', 'D2: octopus into default']);
      mergeOid = git(repo, ['rev-parse', 'HEAD']); mergeParents = 4; defaultOids.push(mergeOid);
    } else {
      command(['switch', '-c', kind === 'trunk' ? 'main' : 'feature']);
      protectedOids.push(commit('F1: feature-owned first'), commit('F2: feature-owned second'));
      command(['switch', defaultBranch]);
      if (['into-main', 'into-feature', 'trunk'].includes(kind)) {
        defaultOids.push(commit('D1: default-only commit'));
        if (kind === 'into-feature') command(['switch', 'feature']);
        command(['merge', '--no-ff', kind === 'into-feature' ? defaultBranch : kind === 'trunk' ? 'main' : 'feature', '-m', kind === 'into-feature' ? 'F3: merge default into feature' : 'D2: merge feature into default']);
        mergeOid = git(repo, ['rev-parse', 'HEAD']); mergeParents = 2;
        if (kind === 'into-feature') { protectedOids.push(mergeOid); workingLane = 'other'; }
        else defaultOids.push(mergeOid);
      } else {
        command(['merge', '--ff-only', 'feature']);
        if (kind === 'deleted' || kind === 'continued') command(['branch', '-d', 'feature']);
        if (kind === 'continued') defaultOids.push(commit('D1: default resumes after FF'));
      }
    }
    // Real local bare origin with HEAD metadata; no network or external push.
    fs.mkdirSync(path.dirname(remote), { recursive: true });
    git(root, ['clone', '--bare', repo, remote]);
    git(remote, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['fetch', 'origin']);
    git(repo, ['remote', 'set-head', 'origin', '-a']);
    fs.appendFileSync(path.join(repo, '.git/info/exclude'), '\n/SCENARIO.md\n');
    const scenario = { id, title, kind, repo, defaultBranch, base, protectedOids, defaultOids, mergeOid, mergeParents, workingLane };
    scenarios.push(scenario);
    console.log(`Created ${id}`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ scenarios }, null, 2) + '\n');
}

// Verify with the actual extension model and layout, not a duplicate lane algorithm.
const { scenarios } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-default-verify-'));
const bundle = path.join(temporary, 'model.cjs');
try {
  await build({ stdin: { contents: `export { GitClient } from './src/git/gitClient.ts';
    export { buildGraphFacts } from './src/model/graphBuilder.ts';
    export { createGraphLayout } from './src/layout/graphLayout.ts';
    export { resolveDefaultBranch } from './src/model/defaultBranchResolver.ts';`, resolveDir: project },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { GitClient, buildGraphFacts, createGraphLayout, resolveDefaultBranch } = createRequire(import.meta.url)(bundle);
  const results = [];
  for (const scenario of scenarios) {
    const { repo, id, defaultBranch } = scenario;
    assert.equal(git(repo, ['status', '--porcelain']), '', `${id}: clean worktree`);
    if (scenario.mergeOid) assert.equal(git(repo, ['show', '-s', '--format=%P', scenario.mergeOid]).split(' ').length, scenario.mergeParents);
    const client = new GitClient();
    let changedNodes = 0;
    const comparisons = [];
    for (const showReflog of [false, true]) {
      const snapshot = await client.readSnapshot(repo, 100, showReflog);
      const target = resolveDefaultBranch(snapshot.refs);
      assert.equal(target?.branch, defaultBranch, `${id}: Auto resolves origin HEAD`);
      const protectionReflogs = await client.readBranchProtection(snapshot);
      const facts = buildGraphFacts(snapshot, { showReflog });
      for (const [host, rowHeight, laneWidth] of [['sidebar', 28, 22], ['compact', 30, 34], ['comfortable', 38, 34]]) {
        const options = { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, rowHeight, laneWidth };
        const standard = createGraphLayout(facts, options);
        const fixed = createGraphLayout(facts, { ...options, fixedDefault: target, protectionReflogs });
        const track = fixed.tracks.find((item) => item.refNames.includes(target.refName));
        assert.equal(track?.lane, 0, `${id}: default track`);
        for (const oid of scenario.protectedOids) assert(fixed.nodes.some((n) => n.oid === oid && n.kind === 'commit' && n.lane > 0), `${id}: protected ${oid}`);
        for (const oid of scenario.defaultOids) assert(fixed.nodes.some((n) => n.oid === oid && n.kind === 'commit' && n.lane === 0), `${id}: default ${oid}`);
        const working = fixed.nodes.find((n) => n.kind === 'working-tree');
        assert(working && (scenario.workingLane === 'default' ? working.lane === 0 : working.lane > 0), `${id}: working tree`);
        assert.deepEqual(fixed.edges, standard.edges);
        assert.deepEqual(fixed.nodes.map((n) => [n.id, n.row]), standard.nodes.map((n) => [n.id, n.row]));
        assert.deepEqual(createGraphLayout(facts, options), standard, `${id}: Standard remains unchanged`);
        const changes = fixed.nodes.filter((n, i) => n.lane !== standard.nodes[i].lane).length;
        changedNodes = Math.max(changedNodes, changes);
        comparisons.push({ showReflog, host, changedNodes: changes });
      }
    }
    results.push({ id, changedNodes, comparisons });
    console.log(`PASS ${id}: 6 layouts; max ${changedNodes} nodes change lanes`);
  }
  const instructions = `## 比較手順\n\n1. このフォルダーをVS Codeで開き、Git Linesを表示します。\n2. はてなの左のSettingsで Default Branch = Auto を選択します（origin HEADで自動判定）。\n3. Layout = Standard と Default Fixed を切り替え、グラフを比較します。\n4. Reflog = On / Off、左サイドバー・メイン画面・下部パネルでも確認します。\n\nDefault Fixedではdefaultの列を左端に確保します。F1/F2などfeature由来のコミットは右側の独立列に残します。fast-forward後にmainバッジがfeature列に付いていても正常です。全祖先を左端に押し込む設定ではありません。\n`;
  for (const scenario of scenarios) {
    const result = results.find((r) => r.id === scenario.id);
    const notes = [`default: **${scenario.defaultBranch}**`,
      scenario.kind === 'checkout' ? 'featureのWorking Treeは右側の独立列。コミット未作成でもdefault列に重ならない。' : 'feature由来のコミットは右側の独立列を維持する。',
      scenario.workingLane === 'default' ? 'defaultのWorking Treeは左端。' : 'featureのWorking Treeは右側。',
      scenario.kind === 'deleted' || scenario.kind === 'continued' ? 'feature参照は削除済み。HEAD reflogが残す作成元の記録で列を保護する。' : '',
      scenario.kind === 'into-feature' ? 'mainをfeatureへ取り込んだマージコミットF3も右側。mainのD1は左端。' : '',
      scenario.defaultOids.length ? 'D1/D2などdefault専用コミットは左端。' : '',
      result.changedNodes ? `現在のコードではStandard→Default Fixedで最大${result.changedNodes}ノードの列が変わるため、切替の効果を比較できる。` : '現在のコードでは両モードで列の位置は同じ。元から条件を満たす履歴が崩れないことを確認するケース。'];
    fs.writeFileSync(path.join(scenario.repo, 'SCENARIO.md'), `# ${scenario.id}\n\n${scenario.title}\n\n${instructions}\n## 見るポイント\n\n${notes.filter(Boolean).map((n) => `- ${n}`).join('\n')}\n\nこのシナリオは空コミットで形を明確にしているため、ファイル変更数は0です。Git設定はこのテストrepo内だけに保存しています。\n`);
  }
  fs.mkdirSync(path.dirname(guidePath), { recursive: true });
  fs.writeFileSync(guidePath, `# Default Fixed 目視確認シナリオ\n\n既存のシナリオとは独立した追加セットです。既存setup.ps1の管理対象一覧には含めていません。setup/resetはrepos配下を再生成・削除するため、このセットも失われます。\n\n${instructions}\n## 一覧\n\n| フォルダー | 確認内容 | 列の変化（現コード） |\n|---|---|---|\n${scenarios.map((s) => `| [${s.id}](../repos/${s.id}/SCENARIO.md) | ${s.title} | ${results.find((r) => r.id === s.id).changedNodes ? 'あり' : 'なし・維持確認'} |`).join('\n')}\n\n## 再検証\n\nGit Linesのルートで実行:\n\n\`\`\`powershell\nnode scripts/default-fixed-scenarios.mjs "${root}" --verify\n\`\`\`\n\n新規作成は --verify を外します。既存の同名出力があれば停止し、上書き・削除しません。結果は default-fixed-verification.json に保存します。VS Codeでの目視確認とは別に、実際のGit Linesコードで8シナリオ×6表示条件の列・親子関係・行位置・Auto判定を検証しています。\n`);
  fs.writeFileSync(path.join(root, 'default-fixed-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2) + '\n');
} finally {
  if (fs.existsSync(bundle)) fs.unlinkSync(bundle);
  fs.rmdirSync(temporary);
}
