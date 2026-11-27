import type { GraphLayout } from '../../../src/layout/layoutTypes';
import { allOverlayRelations, type GraphNode } from '../../../src/model/graphModel';
import { normalizeRefName } from '../../../src/model/refDisplay';
import { routeNameForNode } from './routePresentation';
import { linkedWorktreeStatusLabel, operationInProgressLabel } from './workingTreePresentation';
import { operationAnnotationLabel } from './operationPresentation';
import { commitRowsForDisplay } from './commitRowPresentation';

export type FilterKey = 'branch' | 'type' | 'worktree';
export interface FilterQuery { text: string; branch: string[]; type: string[]; worktree: string[] }
interface Token { key: FilterKey; value: string; start: number; end: number }
function tokens(input: string): Token[] {
  const result: Token[] = [];
  // Only complete, supported clauses are syntax. Unknown/unfinished clauses stay searchable text.
  const pattern = /(?:^|\s)(branch|type|worktree):("(?:[^"\\]|\\.)*"|[^\s"]+)(?=\s|$)/g;
  for (const match of input.matchAll(pattern)) {
    const key = match[1].toLowerCase() as FilterKey;
    let value = match[2];
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { continue; } }
    if (!value || (key === 'type' && !['commit','working','operation'].includes(value))
      || (key === 'worktree' && !['linked','clean','detached'].includes(value))) continue;
    const start = match.index! + (match[0].startsWith(' ') || /^\s/.test(match[0]) ? 1 : 0);
    result.push({ key, value, start, end: match.index! + match[0].length });
  }
  return result;
}
export function parseFilter(input: string): FilterQuery {
  const query: FilterQuery = { text: '', branch: [], type: [], worktree: [] };
  let cursor = 0; const text: string[] = [];
  for (const token of tokens(input)) {
    text.push(input.slice(cursor, token.start)); cursor = token.end;
    if (!query[token.key].includes(token.value)) query[token.key].push(token.value);
  }
  text.push(input.slice(cursor)); query.text = text.map(part => part.trim()).filter(Boolean).join(' ');
  return query;
}
export function setFilterValues(input: string, key: FilterKey, values: string[]): string {
  let cursor = 0, remaining = '';
  for (const token of tokens(input).filter(token => token.key === key)) {
    remaining += input.slice(cursor, token.start).trimEnd() + ' '; cursor = token.end;
  }
  remaining += input.slice(cursor).trimStart();
  const clauses = [...new Set(values)].map(value => `${key}:${/\s|["\\]/.test(value) ? JSON.stringify(value) : value}`);
  return [remaining.trim(), ...clauses].filter(Boolean).join(' ');
}
export interface FilterRow { id: string; text: string; branches: string[]; type: string; worktree: string[] }
export function nodeFilterRow(node: GraphNode, layout: GraphLayout): FilterRow {
  const tree = node.workingTree;
  const route = routeNameForNode(node, layout.tracks);
  const linked = node.linkedWorktrees ?? [];
  const badges = [...(node.refBadges ?? []), ...(node.ghostRefBadges ?? [])];
  const branches = [...new Set([route, tree?.branch, ...badges.filter(b => b.kind === 'local' || b.kind === 'remote').map(b => normalizeRefName(b.fullName)),
    ...node.refIds.filter(ref => /^refs\/(heads|remotes)\//.test(ref)).map(normalizeRefName)].filter((x): x is string => Boolean(x)))];
  const text = [node.subject, node.label, node.oid, route, tree?.branch, tree?.path, tree?.detached ? 'detached' : '', tree?.clean ? 'clean' : '',
    node.operation ? operationInProgressLabel(node.operation) : '',
    ...linked.flatMap(t => ['linked worktree', t.branch, t.path, linkedWorktreeStatusLabel(t)]),
    ...(node.operation?.sourceOids ?? []), ...node.refIds, ...badges.map(b => b.fullName)].filter(Boolean).join(' ').toLocaleLowerCase();
  return { id: node.id, text, branches, type: node.kind === 'commit' || node.kind === 'reflog-commit' ? 'commit' : tree ? 'working' : 'operation',
    worktree: [linked.length ? 'linked' : '', tree?.clean ? 'clean' : '', tree?.detached ? 'detached' : ''].filter(Boolean) };
}
export function filterRows(layout: GraphLayout): FilterRow[] {
  const rows = commitRowsForDisplay(layout.nodes).map(node => nodeFilterRow(node, layout));
  for (const row of layout.operationAnnotationRows ?? []) {
    const relation = allOverlayRelations(layout).find(r => r.id === row.relationId);
    if (!relation) continue;
    // Operation annotations are matched by their displayed caption and their explicit ref only.
    const refName = 'refName' in relation ? relation.refName : undefined;
    rows.push({ id: row.id, text: operationAnnotationLabel(relation).toLocaleLowerCase(), branches: refName ? [normalizeRefName(refName)] : [], type: 'operation', worktree: [] });
  }
  return rows;
}
export function matchesFilter(row: FilterRow, query: FilterQuery): boolean {
  return row.text.includes(query.text.toLocaleLowerCase())
    && (!query.branch.length || query.branch.some(branch => row.branches.includes(branch)))
    && (!query.type.length || query.type.includes(row.type))
    && (!query.worktree.length || query.worktree.some(state => row.worktree.includes(state)));
}
