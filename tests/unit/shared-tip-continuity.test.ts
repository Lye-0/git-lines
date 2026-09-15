import { expect, it } from 'vitest';
import { sharedTipRouteContinuity } from '../../src/model/sharedTipRouteContinuity.js';
import { branchCommitOrigins } from '../../src/model/branchProtection.js';
import type { GitCommit, GitRef, ReflogEntry } from '../../src/git/gitTypes.js';
import type { GraphNode } from '../../src/model/graphModel.js';
import { pointForNode, routeEdges } from '../../src/layout/edgeRouter.js';

const commit = (oid: string, parentOids: string[]): GitCommit => ({ oid, parentOids, subject: oid, authorName: 'A', committerName: 'A', authorDate: 1, committerDate: 1 });
const refs: GitRef[] = ['main', 'feature-a'].map((name) => ({ fullName: `refs/heads/${name}`, shortName: name, oid: 'a2', type: 'local' }));
const commits = [commit('a2', ['m1']), commit('m1', ['a1', 'b1']), commit('a1', ['root']), commit('b1', ['root']), commit('root', [])];
const entry = (name: string, index: number, newOid: string, subject: string, previousOid?: string): ReflogEntry => ({ refName: `refs/heads/${name}`, selector: `${name}@{${index}}`, newOid, subject, previousOid, timestamp: 1 });
const logs = [entry('main', 0, 'a2', '', 'root'), entry('main', 1, 'root', 'commit (initial): root'),
  entry('feature-a', 0, 'a2', '', 'a1'), entry('feature-a', 1, 'a1', 'commit: a1'), entry('feature-b', 0, 'b1', 'commit: b1')];

it('continues only the first-parent source route without asserting new creation evidence', () => {
  expect(sharedTipRouteContinuity(commits, refs, logs)).toEqual(new Map([['a2', 'refs/heads/feature-a'], ['m1', 'refs/heads/feature-a'], ['a1', 'refs/heads/feature-a']]));
  expect(branchCommitOrigins(logs, commits).has('a2')).toBe(false);
  expect(branchCommitOrigins(logs, commits).has('m1')).toBe(false);
});

it.each([[28, 22], [30, 34], [38, 34]])('routes the checkout around an intervening sibling node (%i, %i)', (rowHeight, laneWidth) => {
  const nodes: GraphNode[] = [
    { id: 'working', kind: 'working-tree', row: 0, lane: 0, refIds: [] },
    { id: 'sibling', kind: 'commit', row: 1, lane: 1, refIds: [] },
    { id: 'head', kind: 'commit', row: 2, lane: 2, refIds: [] },
  ];
  const options = { rowHeight, laneWidth };
  const [path] = routeEdges(nodes, [{ id: 'checkout', type: 'working-tree', fromNodeId: 'working', toNodeId: 'head' }], options);
  const values = path.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
  const start = pointForNode(nodes[0], options), end = pointForNode(nodes[2], options), obstacle = pointForNode(nodes[1], options);
  expect(values.slice(0, 2)).toEqual([start.x, start.y]);
  expect(values.slice(-2)).toEqual([end.x, end.y]);
  let closest = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000, u = 1 - t;
    const x = u ** 3 * values[0] + 3 * u ** 2 * t * values[2] + 3 * u * t ** 2 * values[4] + t ** 3 * values[6];
    const y = u ** 3 * values[1] + 3 * u ** 2 * t * values[3] + 3 * u * t ** 2 * values[5] + t ** 3 * values[7];
    closest = Math.min(closest, Math.hypot(x - obstacle.x, y - obstacle.y));
  }
  expect(closest).toBeGreaterThan(11);
});

it.each(['missing-parent', 'missing-anchor', 'missing-previous', 'missing-origin', 'conflicting-origin', 'foreign-creation', 'main-merge', 'cycle', 'no-shared-tip'])('does not infer continuity with %s', (reason) => {
  let input = commits.map((c) => ({ ...c, parentOids: [...c.parentOids] }));
  let evidence = logs.map((e) => ({ ...e }));
  let tips = refs;
  if (reason === 'missing-parent') input = input.filter((c) => c.oid !== 'm1');
  if (reason === 'missing-anchor') input = input.filter((c) => c.oid !== 'a1');
  if (reason === 'missing-previous') evidence[2].previousOid = undefined;
  if (reason === 'missing-origin') evidence = evidence.filter((e) => e.newOid !== 'a1');
  if (reason === 'conflicting-origin') evidence.push(entry('main', 2, 'a1', 'commit: a1'));
  if (reason === 'foreign-creation') evidence.push(entry('main', 2, 'm1', 'commit: m1'));
  if (reason === 'main-merge') evidence[0].subject = "merge feature-a: Merge made by the 'ort' strategy.";
  if (reason === 'cycle') input.find((c) => c.oid === 'm1')!.parentOids = ['a2'];
  if (reason === 'no-shared-tip') tips = refs.slice(1);
  const routes = sharedTipRouteContinuity(input, tips, evidence);
  expect([...routes.values()]).not.toContain('refs/heads/feature-a');
});
