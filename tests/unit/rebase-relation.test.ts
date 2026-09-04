import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, ReflogEntry, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { buildRebaseRelations, exclusiveLinearRange, rebaseSessionForEvent } from '../../src/model/rebaseRelation.js';
import { operationAnnotationLabel } from '../../webview/src/components/operationPresentation';

const oid = (letter: string) => letter.repeat(40);

function commit(letter: string, parents: string[], date: number): GitCommit {
  return {
    oid: oid(letter),
    parentOids: parents.map(oid),
    subject: letter,
    authorName: 'A',
    authorDate: date,
    committerName: 'A',
    committerDate: date,
  };
}

function rebaseEvent(from: string, to: string, onto: string, timestamp = 20): HistoryEvent {
  const ontoOid = oid(onto);
  return {
    id: `history:rebase:${timestamp}:${oid(to)}`,
    type: 'rebase',
    refName: 'refs/heads/feature',
    fromOid: oid(from),
    toOid: oid(to),
    boundaryOid: ontoOid,
    timestamp,
    subject: `rebase (finish): refs/heads/feature onto ${ontoOid}`,
    rawReflogMessage: `rebase (finish): refs/heads/feature onto ${ontoOid}`,
  };
}

function sessionReflogs(oldTip: string, newTip: string, onto: string, pickCount: number): ReflogEntry[] {
  const entries: ReflogEntry[] = [{
    refName: 'HEAD',
    previousOid: oid(onto),
    newOid: oid(newTip),
    selector: 'HEAD@{0}',
    timestamp: 20,
    subject: 'rebase (finish): returning to refs/heads/feature',
  }];
  let index = 1;
  for (let pick = 0; pick < pickCount; pick += 1) {
    entries.push({
      refName: 'HEAD',
      previousOid: oid(onto),
      newOid: oid(newTip),
      selector: `HEAD@{${index}}`,
      timestamp: 20 - index,
      subject: 'rebase (pick): replay',
    });
    index += 1;
  }
  entries.push({
    refName: 'HEAD',
    previousOid: oid(oldTip),
    newOid: oid(onto),
    selector: `HEAD@{${index}}`,
    timestamp: 1,
    subject: 'rebase (start): checkout main',
  });
  return entries;
}

const linearCommits: GitCommit[] = [
  commit('3', ['2'], 9),
  commit('2', ['1'], 8),
  commit('1', ['9'], 7),
  commit('e', ['d'], 6),
  commit('d', ['c'], 5),
  commit('c', ['0'], 4),
  commit('f', ['d'], 3),
  commit('9', ['0'], 2),
  commit('0', [], 1),
];

const linearMap = new Map(linearCommits.map((item) => [item.oid, item]));

const baseSnapshot: RepositorySnapshot = {
  repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
  commits: linearCommits,
  refs: [
    { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('9') },
    { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('3') },
  ],
  workingTrees: [{
    worktreeId: 'worktree-0',
    path: 'C:/repo',
    headOid: oid('3'),
    branch: 'feature',
    detached: false,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
  }],
  operations: [],
  reflogs: [],
  historyEvents: [],
  shallowBoundaryOids: [],
  hasMore: false,
  visibleCommitCount: linearCommits.length,
};

describe('completed rebase relations', () => {
  it('RB1 detects a single-commit completed rebase as old=[F] new=[F\']', () => {
    const commits = [
      commit('4', ['9'], 4),
      commit('a', ['0'], 3),
      commit('9', ['0'], 2),
      commit('0', [], 1),
    ];
    const event = rebaseEvent('a', '4', '9');
    const relations = buildRebaseRelations([event], new Map(commits.map((item) => [item.oid, item])), {
      reflogs: sessionReflogs('a', '4', '9', 1),
    });
    expect(relations).toEqual([expect.objectContaining({
      kind: 'rebase',
      oldOids: [oid('a')],
      newOids: [oid('4')],
      oldTipOid: oid('a'),
      newTipOid: oid('4'),
      ontoOid: oid('9'),
      evidence: 'reflog',
    })]);
  });

  it('RB3–RB7 restores a multi-commit linear range oldest → newest, excluding shared base and onto', () => {
    const event = rebaseEvent('e', '3', '9');
    const relations = buildRebaseRelations([event], linearMap, { reflogs: sessionReflogs('e', '3', '9', 3) });
    expect(relations[0]).toMatchObject({
      oldOids: [oid('c'), oid('d'), oid('e')],
      newOids: [oid('1'), oid('2'), oid('3')],
    });
    expect(relations[0]?.oldOids).not.toContain(oid('0'));
    expect(relations[0]?.newOids).not.toContain(oid('9'));
    expect(relations[0]?.oldOids.length).toBe(relations[0]?.newOids.length);
  });

  it('RB4 keeps exclusiveLinearRange in oldest → newest order', () => {
    const ontoReachable = new Set([oid('9'), oid('0')]);
    expect(exclusiveLinearRange(oid('e'), ontoReachable, linearMap)).toEqual([oid('c'), oid('d'), oid('e')]);
    expect(exclusiveLinearRange(oid('3'), ontoReachable, linearMap)).toEqual([oid('1'), oid('2'), oid('3')]);
  });

  it('RB8 withholds a Phase 4 relation when old and new counts differ', () => {
    const commits = [
      commit('2', ['9'], 8),
      commit('e', ['d'], 6),
      commit('d', ['c'], 5),
      commit('c', ['0'], 4),
      commit('9', ['0'], 2),
      commit('0', [], 1),
    ];
    const relations = buildRebaseRelations(
      [rebaseEvent('e', '2', '9')],
      new Map(commits.map((item) => [item.oid, item])),
      { reflogs: sessionReflogs('e', '2', '9', 2) },
    );
    expect(relations).toEqual([]);
  });

  it('RB9 withholds a group relation when the old range is nonlinear', () => {
    const commits = [
      commit('3', ['2'], 9),
      commit('2', ['1'], 8),
      commit('1', ['9'], 7),
      commit('e', ['d', '8'], 6),
      commit('8', ['0'], 5),
      commit('d', ['c'], 5),
      commit('c', ['0'], 4),
      commit('9', ['0'], 2),
      commit('0', [], 1),
    ];
    expect(buildRebaseRelations(
      [rebaseEvent('e', '3', '9')],
      new Map(commits.map((item) => [item.oid, item])),
      { reflogs: sessionReflogs('e', '3', '9', 3) },
    )).toEqual([]);
  });

  it('RB10 withholds a group relation when the new range is nonlinear', () => {
    const commits = [
      commit('3', ['2', '8'], 9),
      commit('8', ['9'], 8),
      commit('2', ['1'], 8),
      commit('1', ['9'], 7),
      commit('e', ['d'], 6),
      commit('d', ['c'], 5),
      commit('c', ['0'], 4),
      commit('9', ['0'], 2),
      commit('0', [], 1),
    ];
    expect(buildRebaseRelations(
      [rebaseEvent('e', '3', '9')],
      new Map(commits.map((item) => [item.oid, item])),
      { reflogs: sessionReflogs('e', '3', '9', 3) },
    )).toEqual([]);
  });

  it('RB11 does not guess a rebase from a finish event without a HEAD session', () => {
    expect(buildRebaseRelations([rebaseEvent('e', '3', '9')], linearMap, { reflogs: [] })).toEqual([]);
    expect(rebaseSessionForEvent(rebaseEvent('e', '3', '9'), [])).toBeUndefined();
  });

  it('RB12 does not treat an in-progress rebase as a completed relation', () => {
    expect(buildRebaseRelations(
      [rebaseEvent('e', '3', '9')],
      linearMap,
      { reflogs: sessionReflogs('e', '3', '9', 3), operations: [{ type: 'rebase', sourceOids: [oid('e')] }] },
    )).toEqual([]);
  });

  it('RB14 and RB15 keep Amend coexistence without absorbing the Amend source into the old group', () => {
    const event = rebaseEvent('e', '3', '9');
    const snapshot: RepositorySnapshot = {
      ...baseSnapshot,
      historyEvents: [
        event,
        {
          id: 'history:amend:15:e',
          type: 'amend',
          refName: 'refs/heads/feature',
          fromOid: oid('f'),
          toOid: oid('e'),
          timestamp: 15,
          subject: 'commit (amend): C',
          rawReflogMessage: 'commit (amend): C',
        },
      ],
      reflogs: sessionReflogs('e', '3', '9', 3),
    };
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    expect(facts.rebaseRelations?.[0]?.oldOids).toEqual([oid('c'), oid('d'), oid('e')]);
    expect(facts.rebaseRelations?.[0]?.oldOids).not.toContain(oid('f'));
    expect(facts.historyRelations).toContainEqual(expect.objectContaining({
      kind: 'amend',
      sourceOid: oid('f'),
      targetOid: oid('e'),
    }));
    expect(facts.nodes.some((node) => node.event?.type === 'rebase')).toBe(false);
    expect(facts.nodes.some((node) => node.event?.type === 'amend')).toBe(false);
  });

  it('RB13 keeps group membership when an old member is still live from another ref', () => {
    const snapshot: RepositorySnapshot = {
      ...baseSnapshot,
      refs: [
        ...baseSnapshot.refs,
        { fullName: 'refs/heads/keep', shortName: 'keep', type: 'local', oid: oid('c') },
      ],
      historyEvents: [rebaseEvent('e', '3', '9')],
      reflogs: sessionReflogs('e', '3', '9', 3),
    };
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    expect(facts.rebaseRelations?.[0]?.oldOids).toContain(oid('c'));
    expect(facts.nodes.find((node) => node.oid === oid('c'))).toMatchObject({ kind: 'commit', previousRoute: false });
    expect(facts.nodes.find((node) => node.oid === oid('e'))).toMatchObject({ kind: 'reflog-commit', previousRoute: true });
  });

  it('RB16 / RB17 withhold an Exact overlay when a group member is not loaded', () => {
    const missingOld = linearCommits.filter((item) => item.oid !== oid('c'));
    const missingNew = linearCommits.filter((item) => item.oid !== oid('1'));
    const event = rebaseEvent('e', '3', '9');
    const reflogs = sessionReflogs('e', '3', '9', 3);
    expect(buildRebaseRelations([event], new Map(missingOld.map((item) => [item.oid, item])), { reflogs })).toEqual([]);
    expect(buildRebaseRelations([event], new Map(missingNew.map((item) => [item.oid, item])), { reflogs })).toEqual([]);
  });

  it('RB18 drops rebase overlays when reflog presentation is off', () => {
    const snapshot: RepositorySnapshot = {
      ...baseSnapshot,
      historyEvents: [rebaseEvent('e', '3', '9')],
      reflogs: sessionReflogs('e', '3', '9', 3),
    };
    const hidden = buildGraphFacts(snapshot, { showReflog: false });
    const layout = createGraphLayout(hidden, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: false });
    expect(hidden.rebaseRelations).toEqual([]);
    expect(hidden.historyRelations).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === oid('e'))).toBeUndefined();
    expect(layout.rebaseRelationPaths).toEqual([]);
    expect(layout.rebaseGroupOutlines).toEqual([]);
    expect(layout.operationAnnotationRows).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === oid('3'))?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === oid('9'))?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === oid('0'))?.kind).toBe('commit');
  });

  it('RB19 keeps parent edges and lanes when a Rebase overlay is added', () => {
    const snapshot: RepositorySnapshot = {
      ...baseSnapshot,
      historyEvents: [rebaseEvent('e', '3', '9')],
      reflogs: sessionReflogs('e', '3', '9', 3),
    };
    const facts = buildGraphFacts(snapshot, { showReflog: true });
    const layout = createGraphLayout(facts, { visibleCommitCount: snapshot.visibleCommitCount, hasMore: false });
    expect(facts.edges).toContainEqual(expect.objectContaining({
      type: 'parent',
      fromNodeId: `commit:${oid('1')}`,
      toNodeId: `commit:${oid('9')}`,
    }));
    expect(facts.nodes.some((node) => node.kind === 'history-event')).toBe(false);
    const parent = layout.edges.find((edge) => edge.type === 'parent' && edge.fromNodeId === `commit:${oid('1')}` && edge.toNodeId === `commit:${oid('9')}`);
    expect(layout.edgePaths?.some((path) => path.id === parent?.id)).toBe(true);
    expect(layout.edgePaths?.some((path) => path.id?.includes(':rebase:before'))).toBe(false);
    expect(layout.nodes.find((node) => node.oid === oid('3'))?.lane).toBe(layout.nodes.find((node) => node.oid === oid('1'))?.lane);
  });

  it('RB23 presents single and multi annotation labels from tips', () => {
    const single = buildRebaseRelations(
      [rebaseEvent('a', '4', '9')],
      new Map([
        commit('4', ['9'], 4),
        commit('a', ['0'], 3),
        commit('9', ['0'], 2),
        commit('0', [], 1),
      ].map((item) => [item.oid, item])),
      { reflogs: sessionReflogs('a', '4', '9', 1) },
    )[0]!;
    const multiple = buildRebaseRelations([rebaseEvent('e', '3', '9')], linearMap, { reflogs: sessionReflogs('e', '3', '9', 3) })[0]!;
    expect(operationAnnotationLabel(single)).toBe(`Rebase · feature: ${oid('a').slice(0, 8)} → ${oid('4').slice(0, 8)}`);
    expect(operationAnnotationLabel(multiple)).toBe(`Rebase · feature: 3 commits · ${oid('e').slice(0, 8)} → ${oid('3').slice(0, 8)}`);
  });
});
