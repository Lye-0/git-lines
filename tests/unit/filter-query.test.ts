import { expect, it } from 'vitest';
import { filterRows, matchesFilter, nodeFilterRow, parseFilter, setFilterValues } from '../../webview/src/components/filterQuery';

it('preserves free text including OIDs and incomplete or unknown clauses', () => {
  for (const text of ['abc123', 'feat: 新しい機能', 'path/example.ts', 'branch:', 'type:unknown', 'branch:"unfinished', 'a  b']) {
    expect(parseFilter(text).text).toBe(text);
  }
  expect(parseFilter('fix branch:main bug').text).toBe('fix bug');
});
it('round trips menu selections without losing free text or other categories', () => {
  let text = setFilterValues('abc123 type:commit', 'branch', ['main', 'feature example', 'quote"test']);
  expect(parseFilter(text)).toEqual({ text:'abc123', type:['commit'], branch:['main','feature example','quote"test'], worktree:[] });
  text = setFilterValues(text, 'branch', ['main']);
  expect(parseFilter(text).branch).toEqual(['main']);
  expect(parseFilter(setFilterValues(text,'branch',[]))).toEqual({text:'abc123',type:['commit'],branch:[],worktree:[]});
  expect(parseFilter('branch:main branch:main').branch).toEqual(['main']);
});
it('combines free text and groups with AND and selections within a group with OR', () => {
  const row = {id:'x',text:'abcdef feature fix',branches:['feature'],type:'commit',worktree:['linked']};
  expect(matchesFilter(row,parseFilter('ABC branch:main branch:feature type:commit worktree:linked'))).toBe(true);
  expect(matchesFilter(row,parseFilter('abcdef branch:main'))).toBe(false);
  expect(matchesFilter(row,parseFilter('abcdef type:working'))).toBe(false);
  expect(matchesFilter(row,parseFilter('missing branch:feature'))).toBe(false);
  expect(matchesFilter(row,parseFilter('branch:Feature'))).toBe(false);
});
const layout: any = { nodes:[], tracks:[{id:'lane',label:'main',refNames:['refs/heads/main']}], historyRelations:[] };
it('indexes arbitrary search terms while excluding tags from branch choices', () => {
  const node: any = {id:'commit:x',kind:'commit',oid:'123456789abc',subject:'feat: 日本語',trackId:'lane',refIds:['refs/heads/main','refs/tags/v1'],
    refBadges:[{kind:'tag',fullName:'refs/tags/v1'}],ghostRefBadges:[{kind:'local',fullName:'refs/heads/old'}],
    linkedWorktrees:[{branch:'side',path:'C:/worktree',clean:true}]};
  const row = nodeFilterRow(node,layout);
  expect(row.branches).toEqual(['main','old']);
  for(const term of ['789abc','日本語','refs/tags/v1','c:/worktree','linked worktree']) expect(matchesFilter(row,parseFilter(term))).toBe(true);
  expect(matchesFilter(row,parseFilter('worktree:linked'))).toBe(true);
});
it('classifies Working Tree separately and does not mutate the graph', () => {
  const graph = {...layout,nodes:[{id:'wt',kind:'working-tree',refIds:[],workingTree:{branch:'main',path:'repo',clean:true,detached:true}}]};
  const before = JSON.stringify(graph);
  const rows = filterRows(graph);
  expect(matchesFilter(rows[0],parseFilter('type:working worktree:detached'))).toBe(true);
  expect(matchesFilter(rows[0],parseFilter('type:commit'))).toBe(false);
  expect(JSON.stringify(graph)).toBe(before);
});

it('keeps operation annotations searchable and skips unavailable relations', () => {
  const graph = {...layout, historyRelations:[{id:'event',kind:'revert',sourceOid:'a',targetOid:'b',refName:'refs/heads/main'}],
    operationAnnotationRows:[{id:'event-row',relationId:'event',row:1},{id:'missing',relationId:'absent',row:2}]};
  const rows=filterRows(graph);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe('operation');
  expect(matchesFilter(rows[0],parseFilter('branch:main type:operation'))).toBe(true);
  expect(matchesFilter(rows[0],parseFilter('revert'))).toBe(true);
});
