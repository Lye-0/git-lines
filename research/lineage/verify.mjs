import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { transformCandidate, lineageRelations, lineageTrackParents } from './prototype.mjs';
import { baselineCommit, baselineSource } from './baseline.mjs';

const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-lines-lineage-audit-'));
const entry = `export {GitClient} from './src/git/gitClient.ts'; export {buildGraphFacts} from './src/model/graphBuilder.ts'; export {createGraphLayout} from './src/layout/graphLayout.ts'; export {resolveDefaultBranch} from './src/model/defaultBranchResolver.ts'; export {pointForNode} from './src/layout/edgeRouter.ts'; export {nodeRingGeometry} from './src/layout/nodeGeometry.ts';`;
const production = process.argv.includes('--production');
for (const name of ['baseline', 'candidate']) await build({ stdin: { contents: entry, resolveDir: root }, outfile: path.join(temp, `${name}.cjs`), bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: production && name === 'candidate' ? [] : [{ name: 'frozen-baseline', setup(build) { build.onLoad({ filter: /(?:graphBuilder|graphLayout|laneLayout|branchProtection)\.ts$/ }, async ({ path: file }) => ({ contents: name === 'baseline' ? baselineSource(file) : transformCandidate(baselineSource(file), file.replaceAll('\\', '/')), loader: 'ts' })); } }] });
const require = createRequire(import.meta.url), base = require(path.join(temp, 'baseline.cjs')), next = require(path.join(temp, 'candidate.cjs'));
const report = { baselineCommit, production, temp, focused: [], matrix: [], pagination: [], evidence: [], errors: [] };
const client = new base.GitClient();
const generated = [];
function repo(name, initial = 'main') {
  const dir = path.join(temp, name); fs.mkdirSync(dir);
  let tick = 0;
  const run = (args) => execFileSync('git', ['-c', 'core.hooksPath=', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: `2026-09-14T${String(1 + Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}:00Z`, GIT_COMMITTER_DATE: `2026-09-14T00:00:00Z` } }).trim();
  run(['init', '-b', initial]); run(['config', 'user.name', 'Lineage audit']); run(['config', 'user.email', 'audit@example.invalid']); run(['config', 'commit.gpgsign', 'false']); run(['config', 'gc.auto', '0']);
  const commit = (name) => { run(['commit', '--allow-empty', '-m', name]); return run(['rev-parse', 'HEAD']); };
  return { dir, run, commit };
}
async function save(f, name, ownership, leftPairs = [], workingOwner) {
  const localClient = new base.GitClient();
  const snapshot = await localClient.readSnapshot(f.dir, 100, true);
  generated.push({ name, snapshot, logs: await localClient.readBranchProtection(snapshot), ownership, leftPairs, workingOwner });
}

const f = repo('main-feature');
const d0 = f.commit('D0'); f.run(['switch', '-c', 'feature']);
await save(f, 'checkout-zero', [[d0, 'main']], [], 'feature');
const f1 = f.commit('F1'), f2 = f.commit('F2');
await save(f, 'unmerged', [[d0, 'main'], [f1, 'feature'], [f2, 'feature']], [[d0, f1]], 'feature');
f.run(['switch', 'main']); f.run(['merge', '--ff-only', 'feature']);
await save(f, 'FF', [[d0, 'main'], [f1, 'feature'], [f2, 'feature']], [[d0, f1]], 'main');
f.run(['branch', '-d', 'feature']);
await save(f, 'FF-deleted', [[d0, 'main'], [f1, 'feature'], [f2, 'feature']], [[d0, f1]], 'main');
const d1 = f.commit('D1');
await save(f, 'FF-main-continues', [[d0, 'main'], [d1, 'main'], [f1, 'feature']], [[d1, f1]], 'main');

const nested = repo('nested'); const rootOid = nested.commit('root');
nested.run(['switch', '-c', 'z-parent']); const p1 = nested.commit('P1');
nested.run(['switch', '-c', 'a-child']);
await save(nested, 'nested-zero', [[rootOid, 'main'], [p1, 'z-parent']], [], 'a-child');
const c1 = nested.commit('C1');
await save(nested, 'nested-unmerged', [[rootOid, 'main'], [p1, 'z-parent'], [c1, 'a-child']], [[p1, c1]], 'a-child');
nested.run(['switch', 'z-parent']); const p2 = nested.commit('P2');
await save(nested, 'nested-parent-advances', [[rootOid, 'main'], [p1, 'z-parent'], [p2, 'z-parent'], [c1, 'a-child']], [[p2, c1]], 'z-parent');
nested.run(['merge', '--no-ff', 'a-child', '-m', 'child into parent']); const pm = nested.run(['rev-parse', 'HEAD']);
await save(nested, 'nested-child-into-parent', [[p1, 'z-parent'], [p2, 'z-parent'], [c1, 'a-child'], [pm, 'z-parent']], [[pm, c1]], 'z-parent');

const reverse = repo('reverse'); const r0 = reverse.commit('R0');
reverse.run(['switch', '-c', 'feature']); const rf = reverse.commit('RF');
reverse.run(['switch', 'main']); const rm = reverse.commit('RM');
reverse.run(['switch', 'feature']); reverse.run(['merge', '--no-ff', 'main', '-m', 'main into feature']); const merge = reverse.run(['rev-parse', 'HEAD']);
await save(reverse, 'main-into-feature', [[r0, 'main'], [rf, 'feature'], [rm, 'main'], [merge, 'feature']], [], 'feature');
reverse.run(['switch', 'main']); reverse.run(['merge', '--ff-only', 'feature']);
await save(reverse, 'main-into-feature-then-FF', [[r0, 'main'], [rf, 'feature'], [rm, 'main'], [merge, 'feature']], [], 'main');

const other = repo('nonstandard-root', 'z-root'); const z0 = other.commit('Z0');
other.run(['switch', '-c', 'a-child']); const ac = other.commit('AC');
other.run(['switch', 'z-root']); const z1 = other.commit('Z1'); other.run(['switch', 'a-child']);
await save(other, 'no-default-nonstandard-root', [[z0, 'z-root'], [z1, 'z-root'], [ac, 'a-child']], [[z1, ac]], 'a-child');

const slash = repo('slash-root', 'release/base'); const s0 = slash.commit('S0');
slash.run(['switch', '-c', 'feature/topic']); const s1 = slash.commit('S1');
await save(slash, 'slash-parent-child', [[s0, 'release/base'], [s1, 'feature/topic']], [[s0, s1]], 'feature/topic');

const actual148 = await new base.GitClient().readSnapshot('C:/Users/kawau/dev/test/repos/148-default-remote-only', 100, true);
generated.push({ name: 'actual-148', snapshot: actual148, logs: await client.readBranchProtection(actual148), ownership: actual148.commits.map((c) => [c.oid, c.subject.startsWith('F') ? 'feature' : 'main']), leftPairs: [[actual148.commits.find((c) => c.subject.startsWith('D2')).oid, actual148.commits.find((c) => c.subject.startsWith('F2')).oid]], workingOwner: 'feature' });

const semanticFields = ['edges', 'historyRelations', 'refMovementRelations', 'rebaseRelations', 'cherryPickGroupRelations', 'rewriteCollapseRelations', 'operationAnnotationRows'];
const json = JSON.stringify;
function samplePath(d) {
  const tokens = d.match(/[MLC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi); let i = 0, p; const out = [];
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') { p = { x: +tokens[i++], y: +tokens[i++] }; out.push(p); }
    else if (cmd === 'L') { const q = { x: +tokens[i++], y: +tokens[i++] }; for (let k = 1; k <= 120; k++) { const t = k / 120; out.push({ x: p.x + (q.x-p.x)*t, y: p.y + (q.y-p.y)*t }); } p = q; }
    else if (cmd === 'C') { const b = { x: +tokens[i++], y: +tokens[i++] }, c = { x: +tokens[i++], y: +tokens[i++] }, q = { x: +tokens[i++], y: +tokens[i++] }; for (let k = 1; k <= 120; k++) { const t = k/120, u = 1-t; out.push({ x:u**3*p.x+3*u**2*t*b.x+3*u*t**2*c.x+t**3*q.x,y:u**3*p.y+3*u**2*t*b.y+3*u*t**2*c.y+t**3*q.y }); } p = q; }
    else throw Error('Unexpected path command ' + cmd);
  }
  return out;
}
function collisions(layout) {
  const hits = new Set(), edges = new Map(layout.edges.map((e) => [e.id,e]));
  for (const route of layout.edgePaths ?? []) {
    const edge = edges.get(route.edgeId ?? route.id); if (edge?.type !== 'parent') continue;
    const points = samplePath(route.d);
    for (const node of layout.nodes) {
      if (node.id === edge.fromNodeId || node.id === edge.toNodeId || !['commit','reflog-commit','working-tree'].includes(node.kind)) continue;
      const center = base.pointForNode(node, layout), radius = base.nodeRingGeometry(node).r + 1;
      if (points.some((p) => Math.hypot(p.x-center.x,p.y-center.y) < radius)) hits.add(edge.id + ' -> ' + node.id);
    }
  }
  return hits;
}
function check(layout, item) {
  const failures = [], find = (oid) => layout.nodes.find((n) => n.kind === 'commit' && n.oid === oid);
  const family = (node) => layout.tracks.find((t) => t.id === node?.trackId)?.family;
  for (const [oid, name] of item.ownership) if (family(find(oid)) !== name) failures.push(`owner ${item.snapshot.commits.find((c) => c.oid === oid)?.subject}: ${family(find(oid))} != ${name}`);
  for (const [a, b] of item.leftPairs) if (!(find(a)?.lane < find(b)?.lane)) failures.push(`left order ${find(a)?.lane} !< ${find(b)?.lane}`);
  const working = layout.nodes.find((n) => n.kind === 'working-tree');
  if (family(working) !== item.workingOwner) failures.push('working owner');
  for (const [oid, name] of item.ownership) if (name !== item.workingOwner && find(oid)?.lane === working?.lane) failures.push(`working column overlaps ${name}`);
  return [...new Set(failures)];
}
for (const item of generated) for (const showReflog of [false, true]) for (const [host, rowHeight, laneWidth] of [['sidebar', 28, 22], ['compact', 30, 34], ['comfortable', 38, 34]]) for (const mode of ['standard', 'fixed']) {
  const target = base.resolveDefaultBranch(item.snapshot.refs) ?? (() => { const ref = item.snapshot.refs.find((r) => r.fullName === 'refs/heads/main'); return ref && { refName: ref.fullName, branch: 'main', oid: ref.oid, source: 'manual' }; })();
  const options = { visibleCommitCount: 100, hasMore: false, rowHeight, laneWidth, protectionReflogs: item.logs, fixedDefault: mode === 'fixed' ? target : undefined };
  const a = base.createGraphLayout(base.buildGraphFacts(item.snapshot, { showReflog }), options);
  const b = next.createGraphLayout(next.buildGraphFacts(item.snapshot, { showReflog }), options);
  report.focused.push({ name: item.name, mode, host, showReflog, baseline: check(a, item), candidate: check(b, item), semanticChanges: semanticFields.filter((field) => json(a[field]) !== json(b[field])), rowChanges: json(a.nodes.map((n) => [n.id, n.row])) !== json(b.nodes.map((n) => [n.id, n.row])) });
}
console.log('FOCUSED', json({ cases: report.focused.length, failingCases: report.focused.filter((r) => r.candidate.length).length, failures: [...new Set(report.focused.filter((r) => r.candidate.length).map((r) => r.name + ': ' + r.candidate.join('; ')))] }));

for (const item of generated.filter((r) => r.name !== 'actual-148')) {
  const options = { visibleCommitCount: 100, hasMore: false, protectionReflogs: [] };
  const a = base.createGraphLayout(base.buildGraphFacts(item.snapshot), options), b = next.createGraphLayout(next.buildGraphFacts(item.snapshot), options);
  report.evidence.push({ name: item.name + '-expired', unchanged: json(a) === json(b) });
}
const created = { refName:'refs/heads/child',newOid:'base',timestamp:1,subject:'branch: Created from HEAD' };
const checkout = (parent) => ({refName:'HEAD',newOid:'base',previousOid:'base',timestamp:1,subject:`checkout: moving from ${parent} to child`});
for (const [name, logs] of [['checkout-without-create',[checkout('main')]], ['conflicting-checkouts',[created,checkout('main'),checkout('other')]], ['revision-start',[{...created,subject:'branch: Created from main~1'}]]]) report.evidence.push({ name, unchanged: lineageRelations(logs).length === 0 });
const candidates = ['a','b'].map((family) => ({id:family,family}));
report.evidence.push({name:'cyclic-names',unchanged:lineageTrackParents(candidates,[{...created,refName:'refs/heads/a',subject:'branch: Created from b'},{...created,refName:'refs/heads/b',subject:'branch: Created from a'}]).size===0});

const ambiguous = [];
for (const actualParent of ['main','sibling']) {
  const f = repo('ambiguous-' + actualParent); f.commit('same base'); f.run(['branch','sibling']);
  if (actualParent === 'main') f.run(['branch','child','HEAD']);
  f.run(['switch','sibling']);
  if (actualParent === 'sibling') f.run(['branch','child','HEAD']);
  f.run(['switch','child']);
  const snapshot = await new base.GitClient().readSnapshot(f.dir,100,true);
  ambiguous.push({ actualParent, refs: snapshot.refs, logs:snapshot.reflogs });
}
const sameEvidence = json(ambiguous[0].refs) === json(ambiguous[1].refs) && json(ambiguous[0].logs) === json(ambiguous[1].logs);
report.evidence.push({name:'creation-before-vs-after-switch',sameEvidence,actualParents:ambiguous.map((a)=>a.actualParent),unchanged:ambiguous.every((a)=>!lineageRelations(a.logs).some((r)=>r.child==='child'))});

for (const [name, dir] of [['test','C:/Users/kawau/dev/test'],['nested',nested.dir],['148','C:/Users/kawau/dev/test/repos/148-default-remote-only']]) {
  const reader = new base.GitClient();
  for (const mode of ['standard','fixed']) {
    let previousA,previousB;
    for (const count of [2,4,8,16,50]) {
      const snapshot = await reader.readSnapshot(dir,count,true), logs = await reader.readBranchProtection(snapshot);
      const options = {visibleCommitCount:snapshot.visibleCommitCount,hasMore:snapshot.hasMore,protectionReflogs:logs,fixedDefault:mode==='fixed'?base.resolveDefaultBranch(snapshot.refs):undefined};
      const withPrevious = (prev) => ({...options,previousRows:prev&&new Map(prev.nodes.map((n)=>[n.id,n.row])),previousLanes:prev&&new Map(prev.tracks.map((t)=>[t.id,t.lane])),previousNodeLanes:prev&&new Map(prev.nodes.map((n)=>[n.id,n.lane]))});
      const a=base.createGraphLayout(base.buildGraphFacts(snapshot),withPrevious(previousA)), b=next.createGraphLayout(next.buildGraphFacts(snapshot),withPrevious(previousB));
      const shifts=(layout,prev)=>layout.nodes.filter((n)=>n.kind==='commit'&&prev?.nodes.some((p)=>p.id===n.id&&(p.row!==n.row||p.lane!==n.lane||p.trackId!==n.trackId))).map((n)=>n.subject);
      report.pagination.push({name,mode,count,baselineShifts:shifts(a,previousA),candidateShifts:shifts(b,previousB)});
      previousA=a;previousB=b;
    }
  }
}

const cached = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? fs.readFileSync(path.join(os.tmpdir(), 'git-lines-lane-review-path.txt'), 'utf8').trim();
for (const file of fs.readdirSync(cached).filter((name) => name.endsWith('.snapshot.json'))) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(cached, file), 'utf8'));
  for (const showReflog of [false, true]) for (const [rowHeight, laneWidth] of [[28, 22], [30, 34], [38, 34]]) for (const mode of ['standard', 'fixed']) {
    const options = { visibleCommitCount: snapshot.visibleCommitCount, hasMore: snapshot.hasMore, rowHeight, laneWidth, protectionReflogs: snapshot.reflogs, fixedDefault: mode === 'fixed' ? base.resolveDefaultBranch(snapshot.refs) : undefined };
    const a = base.createGraphLayout(base.buildGraphFacts(snapshot, { showReflog }), options);
    const b = next.createGraphLayout(next.buildGraphFacts(snapshot, { showReflog }), options);
    const fields = semanticFields.filter((field) => json(a[field]) !== json(b[field]));
    const changed = json(a) !== json(b);
    const beforeHits = changed ? collisions(a) : new Set(), afterHits = changed ? collisions(b) : new Set();
    report.matrix.push({ name: file.replace('.snapshot.json', ''), showReflog, rowHeight, mode, changed, semanticChanges: fields, rowChanges: json(a.nodes.map((n) => [n.id, n.row])) !== json(b.nodes.map((n) => [n.id, n.row])), changedNodes: b.nodes.filter((n, i) => n.lane !== a.nodes[i]?.lane || n.trackId !== a.nodes[i]?.trackId).length, introducedHits: [...afterHits].filter((hit)=>!beforeHits.has(hit)),
      pathsChanged: ['edgePaths', 'refMovementPaths', 'historyRelationPaths', 'rebaseRelationPaths', 'cherryPickGroupPaths', 'rewriteCollapsePaths'].filter((field) => json(a[field]) !== json(b[field])) });
  }
}
fs.writeFileSync(production ? 'research/lineage/implementation-results.json' : 'research/lineage/results.json', JSON.stringify(report, null, 2) + '\n');
console.log('MATRIX', json({ cases: report.matrix.length, changedRepositories: [...new Set(report.matrix.filter((r) => r.changed).map((r) => r.name))], semanticOrRows: report.matrix.filter((r) => r.semanticChanges.length || r.rowChanges).length }));
console.log('Artifacts:', temp);
const failures = {
  focused: report.focused.filter((r) => r.candidate.length || r.semanticChanges.length || r.rowChanges),
  evidence: report.evidence.filter((r) => !r.unchanged || r.sameEvidence === false),
  matrix: report.matrix.filter((r) => r.semanticChanges.length || r.rowChanges || r.introducedHits.length),
  pagination: report.pagination.filter((r) => r.candidateShifts.length > r.baselineShifts.length),
};
if (Object.values(failures).some((list) => list.length)) { console.error('Unresolved verification failures:', json(failures)); process.exitCode = 1; }
