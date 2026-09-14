// Verification-only candidate. Not imported by the extension or its build.
import { branchCommitOrigins } from '../../src/model/branchProtection.ts';

const family = (ref) => ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');

export function lineageRelations(logs) {
  const results = [];
  for (const log of logs) {
    if (!log.refName.startsWith('refs/heads/') || !log.subject.startsWith('branch: Created from ')) continue;
    const child = family(log.refName), from = log.subject.slice('branch: Created from '.length);
    let parent = from;
    if (from === 'HEAD') {
      // Creation and a later checkout can have the same OID/timestamp. With
      // multiple possible source refs, Git does not record their global order.
      const possible = new Set(logs.filter((e) => e.refName.startsWith('refs/heads/') && e.refName !== log.refName && e.newOid === log.newOid).map((e) => family(e.refName)));
      if (possible.size > 1) continue;
      const matches = logs.filter((e) => (e.refName === 'HEAD' || /\/HEAD$/.test(e.refName))
        && e.newOid === log.newOid && e.previousOid === log.newOid && e.timestamp === log.timestamp
        && e.subject.endsWith(` to ${child}`) && e.subject.startsWith('checkout: moving from '));
      const sources = new Set(matches.map((e) => e.subject.slice('checkout: moving from '.length, -` to ${child}`.length)));
      if (sources.size !== 1) continue;
      parent = [...sources][0];
    }
    parent = family(parent);
    if (parent === child || /[~^:?*\[\s]|\.\.|@\{|\\/.test(parent) || /^(?:HEAD|[0-9a-f]{7,64})$/.test(parent)) continue;
    results.push({ parent, child, base: log.newOid });
  }
  // Recreated names with conflicting parents are not one reliable lineage.
  return results.filter((r) => new Set(results.filter((x) => x.child === r.child).map((x) => x.parent)).size === 1);
}

export function lineageTrackParents(candidates, logs) {
  const relations = lineageRelations(logs);
  const idFor = (name) => {
    const matches = candidates.filter((c) => c.family === name && !c.synthetic);
    return matches.length === 1 ? matches[0].id : undefined;
  };
  const parents = new Map();
  for (const r of relations) {
    const parent = idFor(r.parent), child = idFor(r.child);
    if (parent && child && parent !== child) parents.set(child, parent);
  }
  for (const child of [...parents.keys()]) {
    const seen = new Set([child]); let current = parents.get(child);
    while (current) {
      if (seen.has(current)) { for (const id of seen) parents.delete(id); break; }
      seen.add(current); current = parents.get(current);
    }
  }
  return parents;
}

export function correctOrigins(trackByOid, candidates, facts) {
  const logs = facts.lineageLogs ?? [];
  const parents = lineageTrackParents(candidates, logs);
  const origins = branchCommitOrigins(logs, facts.commits);
  for (const [oid, name] of origins) {
    const matches = candidates.filter((c) => c.family === family(name) && !c.synthetic);
    if (matches.length !== 1) continue;
    const destination = matches[0].id, current = trackByOid.get(oid);
    let ancestor = parents.get(current);
    while (ancestor) {
      if (ancestor === destination) { trackByOid.set(oid, destination); break; }
      ancestor = parents.get(ancestor);
    }
    ancestor = parents.get(destination);
    while (ancestor) {
      if (ancestor === current) { trackByOid.set(oid, destination); break; }
      ancestor = parents.get(ancestor);
    }
    const existing = candidates.find((c) => c.id === current);
    if (existing?.family.startsWith('merged-side:') && (parents.has(destination) || [...parents.values()].includes(destination))) trackByOid.set(oid, destination);
  }
}

export function choosePrimary(facts, logs, explicit) {
  if (explicit) return explicit;
  const relations = lineageRelations(logs);
  const names = new Map(facts.refs.filter((r) => r.type === 'local').map((r) => [family(r.fullName), r.shortName]));
  for (const ref of facts.refs.filter((r) => r.type === 'remote')) if (!names.has(family(ref.fullName))) names.set(family(ref.fullName), ref.shortName);
  let current = facts.primaryBranch;
  const initialRef = facts.refs.find((r) => r.fullName === current || r.shortName === current);
  let name = initialRef ? family(initialRef.fullName) : current;
  const seen = new Set();
  while (name && !seen.has(name)) {
    seen.add(name);
    const relation = relations.find((r) => r.child === name && names.has(r.parent));
    if (!relation) break;
    current = names.get(relation.parent); name = relation.parent;
  }
  return current;
}

export function orderSegments(segments, parents = new Map(), primaryTrackId) {
  const result = [], remaining = [...segments];
  while (remaining.length) {
    const index = remaining.findIndex((s) => parents.get(s.trackId) === primaryTrackId || !remaining.some((p) => p.trackId === parents.get(s.trackId)));
    if (index < 0) return segments;
    result.push(...remaining.splice(index, 1));
  }
  return result;
}

export function minimumLane(segment, segments, result, parents = new Map()) {
  const lanes = segments.filter((s) => s.trackId === parents.get(segment.trackId)).map((s) => result.get(s.id)).filter((n) => n !== undefined);
  return lanes.length ? Math.max(...lanes) + 1 : 1;
}

export function transformCandidate(source, file) {
  let code = source.replaceAll('\r\n', '\n');
  const replace = (a, b) => { if (!code.includes(a)) throw Error(`Missing transform anchor in ${file}: ${a}`); code = code.replace(a, b); };
  if (file.endsWith('/graphBuilder.ts')) {
    replace("if (snapshot.refs.some((ref) => ref.type === 'local' && normalizeRefName(ref.fullName) === target)) return target;",
      "if (snapshot.refs.some((ref) => ref.type === 'local' && normalizeRefName(ref.fullName) === target)) return target;\n    if (snapshot.refs.some((ref) => ref.fullName === defaultRemote.targetRef && ref.type === 'remote')) return normalizeRefName(defaultRemote.targetRef);");
  } else if (file.endsWith('/graphLayout.ts')) {
    const helper = decodeURIComponent(new URL('./prototype.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'));
    code = `import { choosePrimary } from ${JSON.stringify(helper)};\n` + code;
    replace('computeLaneLayout({ ...facts, nodes: rows.nodes }', 'computeLaneLayout({ ...facts, nodes: rows.nodes, lineageLogs: options.protectionReflogs ?? [] }');
    replace('primaryBranch: options.primaryBranch,', 'primaryBranch: choosePrimary(facts, options.protectionReflogs ?? [], options.primaryBranch),');
  } else if (file.endsWith('/branchProtection.ts')) {
    replace("/^commit(?: \\((?:initial|amend)\\))?: /.test(subject)", "/^commit(?: \\((?:initial|amend)\\))?: /.test(subject) || /^merge .*: Merge made by /.test(subject)");
  } else if (file.endsWith('/laneLayout.ts')) {
    const helper = new URL('./prototype.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
    code = `import { lineageTrackParents, correctOrigins, orderSegments, minimumLane } from ${JSON.stringify(decodeURIComponent(helper))};\n` + code;
    replace('for (const segment of ordered) {', 'for (const segment of orderSegments(ordered, options.lineageParents, options.primaryTrackId)) {');
    replace('while (!isAvailable(lane, segment)) lane += 1;', 'lane = Math.max(lane, minimumLane(segment, segments, result, options.lineageParents));\n    while (!isAvailable(lane, segment)) lane += 1;');
    replace('const segments = buildBranchSegments(initialAssignments, facts.edges);', 'const segments = buildBranchSegments(initialAssignments, facts.edges);');
    replace('primaryTrackId: primaryCandidate?.id,', 'primaryTrackId: primaryCandidate?.id,\n    lineageParents: lineageTrackParents(candidates, facts.lineageLogs ?? []),');
    // Run after original claim assignment, before initialAssignments consume it.
    const anchor = 'const initialAssignments =';
    replace(anchor, 'correctOrigins(trackByOid, candidates, facts);\n  ' + anchor);
  }
  return code;
}
