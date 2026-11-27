import { expect, it } from 'vitest';
import { assertRowInvariants, computeRowLayout } from '../../src/layout/rowLayout.js';
import type { GraphEdge, GraphNode } from '../../src/model/graphModel.js';

function node(id: string, timestamp: number, kind: GraphNode['kind'] = 'commit'): GraphNode {
  return { id, oid: kind === 'working-tree' ? undefined : id, kind, timestamp, refIds: [] };
}
const parent = (from: string, to: string): GraphEdge => ({ id: `${from}:${to}`, type:'parent', fromNodeId:from, toNodeId:to });

it.each([false,true])('reflows cached ancestor rows when an unread bridge is loaded (ref event=%s)', event => {
  const first = [node('wt',11,'working-tree'), node('tip',10), node('old',4,'reflog-commit'), node('base',3,'reflog-commit'), node('unread',0,'history-boundary')];
  const firstEdges: GraphEdge[] = [{ id:'wt:tip',type:'working-tree',fromNodeId:'wt',toNodeId:'tip' },parent('tip','unread'),parent('old','base')];
  if(event) first.push({...node('event',12,'history-event'),anchorCommitId:'old'});
  const before = computeRowLayout(first,firstEdges);
  const expanded = [first[0],first[1],node('bridge1',2),node('bridge2',1),node('old',4),node('base',3)];
  if(event) expanded.push({...node('event',12,'history-event'),anchorCommitId:'old'});
  const edges: GraphEdge[] = [firstEdges[0],parent('tip','bridge1'),parent('bridge1','bridge2'),parent('bridge2','old'),parent('old','base')];
  const input = structuredClone(expanded), edgeInput = structuredClone(edges);
  const after = computeRowLayout(expanded,edges,before.rows);
  assertRowInvariants(after.nodes,edges);
  expect(after.nodes.map(n=>[n.id,n.row])).toEqual(computeRowLayout(expanded,edges).nodes.map(n=>[n.id,n.row]));
  expect(after.nodes.find(n=>n.id==='wt')?.row).toBe(0);
  expect(after.nodes.find(n=>n.id==='tip')?.row).toBe(1);
  expect(expanded).toEqual(input);expect(edges).toEqual(edgeInput);
  const nextNodes = [...after.nodes,node('older',0)];
  const nextEdges = [...edges,parent('base','older')];
  const next = computeRowLayout(nextNodes,nextEdges,after.rows);
  assertRowInvariants(next.nodes,nextEdges);
  for(const n of after.nodes) expect(next.rows.get(n.id)).toBe(n.row);
});

it.each(['parent','working-tree','operation'] as const)('rejects reversed cached %s constraints, including explicit node rows', type => {
  const nodes = [{...node('child',1),row:3},{...node('parent',2),row:1}];
  const edges: GraphEdge[] = [{id:'edge',type,fromNodeId:'child',toNodeId:'parent'}];
  const result=computeRowLayout(nodes,edges,new Map([['child',3],['parent',1]]));
  expect(result.rows.get('child')).toBeLessThan(result.rows.get('parent')!);
});
