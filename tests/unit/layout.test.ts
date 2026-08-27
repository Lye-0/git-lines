import { describe, expect, it } from 'vitest';
import { computeLaneLayout } from '../../src/layout/laneLayout.js';
import { computeRowLayout, assertRowInvariants } from '../../src/layout/rowLayout.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import type { GraphFactModel, GraphNode } from '../../src/model/graphModel.js';

const oid = (letter: string) => letter.repeat(40);
function commitNode(letter: string, date: number): GraphNode { return { id: `commit:${oid(letter)}`, kind: 'commit', oid: oid(letter), refIds: [], timestamp: date, subject: letter }; }

describe('graph layout', () => {
  it('keeps every node on a unique row and parents below children despite timestamp inversion', () => {
    const child = commitNode('a', 100);
    const parent = commitNode('b', 200);
    const edge = { id: 'parent:a:b', type: 'parent' as const, fromNodeId: child.id, toNodeId: parent.id };
    const result = computeRowLayout([child, parent], [edge]);
    assertRowInvariants(result.nodes, [edge]);
    expect(result.rows.get(child.id)).toBeLessThan(result.rows.get(parent.id)!);
  });

  it('assigns primary branch to lane zero and keeps a stopped main separate from feature commits', () => {
    const a = commitNode('a', 1);
    const b = { ...commitNode('b', 2), refIds: ['feature'] };
    const main = { fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') };
    const feature = { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const, oid: oid('b') };
    const facts: GraphFactModel = { nodes: [a, b], edges: [], refs: [main, feature], commits: [{ oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 }, { oid: oid('b'), parentOids: [oid('a')], subject: 'b', authorName: 'B', authorDate: 2, committerName: 'B', committerDate: 2 }], workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const result = computeLaneLayout(facts);
    expect(result.lanes.get('family:main')).toBe(0);
    expect(result.nodes.find((node) => node.oid === oid('a'))?.lane).toBe(0);
    expect(result.nodes.find((node) => node.oid === oid('b'))?.lane).toBeGreaterThan(0);
  });

  it('merges local and remote refs on the same commit into one family track', () => {
    const node = commitNode('a', 1);
    const refs = [
      { fullName: 'refs/heads/feature/x', shortName: 'feature/x', type: 'local' as const, oid: oid('a') },
      { fullName: 'refs/remotes/origin/feature/x', shortName: 'origin/feature/x', type: 'remote' as const, oid: oid('a') },
    ];
    const facts: GraphFactModel = { nodes: [node], edges: [], refs, commits: [{ oid: oid('a'), parentOids: [], subject: 'a', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 }], workingTrees: [], operations: [], events: [], shallowBoundaryOids: [] };
    const result = computeLaneLayout(facts);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].refNames).toEqual(refs.map((ref) => ref.fullName));
  });

  it('keeps existing row and lane assignments when older page nodes are appended', () => {
    const a = commitNode('a', 3);
    const b = { ...commitNode('b', 2), refIds: ['main'] };
    const c = commitNode('c', 1);
    const refs = [{ fullName: 'refs/heads/main', shortName: 'main', type: 'local' as const, oid: oid('a') }];
    const commits = [
      { oid: oid('a'), parentOids: [oid('b')], subject: 'a', authorName: 'A', authorDate: 3, committerName: 'A', committerDate: 3 },
      { oid: oid('b'), parentOids: [oid('c')], subject: 'b', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
      { oid: oid('c'), parentOids: [], subject: 'c', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
    ];
    const facts = { nodes: [a, b], edges: [{ id: 'ab', type: 'parent' as const, fromNodeId: a.id, toNodeId: b.id }], refs, commits: commits.slice(0, 2), workingTrees: [], operations: [], events: [], primaryBranch: 'main', shallowBoundaryOids: [] };
    const first = createGraphLayout(facts, { visibleCommitCount: 2, hasMore: true });
    const expanded = createGraphLayout({ ...facts, nodes: [...facts.nodes, c], commits }, { visibleCommitCount: 3, hasMore: false, previousRows: new Map(first.nodes.map((node) => [node.id, node.row!])), previousLanes: new Map(first.tracks.map((track) => [track.id, track.lane])) });
    expect(expanded.nodes.find((node) => node.id === a.id)?.row).toBe(first.nodes.find((node) => node.id === a.id)?.row);
    expect(expanded.nodes.find((node) => node.id === b.id)?.lane).toBe(first.nodes.find((node) => node.id === b.id)?.lane);
  });
});
