import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, ReflogEntry, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { routeRewriteCollapseRelations } from '../../src/layout/edgeRouter.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import type { GraphNode, RewriteCollapseRelation } from '../../src/model/graphModel.js';
import { allOverlayRelations } from '../../src/model/graphModel.js';
import { buildRewriteCollapseRelations, rewriteCollapseRelationId, transientOidsForRewriteCollapse } from '../../src/model/rewriteCollapseRelation.js';
import { overlayCommitList, overlayDetailFields, overlayDetailTitle, operationDetailContent, resolveSelectedOperationDetail } from '../../webview/src/components/overlayDetailPresentation';
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

function collapseEvent(from: string, to: string, onto: string, timestamp = 20): HistoryEvent {
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

function entry(index: number, previous: string, next: string, subject: string, timestamp: number): ReflogEntry {
  return {
    refName: 'HEAD',
    previousOid: oid(previous),
    newOid: oid(next),
    selector: `HEAD@{${index}}`,
    timestamp,
    subject,
  };
}

/** start → pick A' → squash/fixup S → finish. Matches 122/123. */
function contiguousCollapseReflogs(kind: 'squash' | 'fixup'): ReflogEntry[] {
  return [
    entry(0, 's', 's', 'rebase (finish): returning to refs/heads/feature', 20),
    entry(1, 'p', 's', `rebase (${kind}): Feature target A`, 19),
    entry(2, '9', 'p', 'rebase (pick): Feature target A', 18),
    entry(3, 'b', '9', 'rebase (start): checkout main', 17),
  ];
}

/** start → pick A' → fixup F → pick B' → finish. Matches 124. */
function noncontiguousReflogs(kind: 'squash' | 'fixup'): ReflogEntry[] {
  return [
    entry(0, '2', '2', 'rebase (finish): returning to refs/heads/feature', 20),
    entry(1, 'f', '2', 'rebase (pick): Independent middle B', 19),
    entry(2, 'p', 'f', `rebase (${kind}): Feature target A`, 18),
    entry(3, '9', 'p', 'rebase (pick): Feature target A', 17),
    entry(4, 'c', '9', 'rebase (start): checkout main', 16),
  ];
}

const contiguousCommits: GitCommit[] = [
  commit('s', ['9'], 10),
  commit('p', ['9'], 9),
  commit('b', ['a'], 6),
  commit('a', ['0'], 5),
  commit('9', ['0'], 2),
  commit('0', [], 1),
];

const noncontiguousCommits: GitCommit[] = [
  commit('2', ['f'], 12),
  commit('f', ['9'], 11),
  commit('p', ['9'], 10),
  commit('c', ['b'], 6),
  commit('b', ['a'], 5),
  commit('a', ['0'], 4),
  commit('9', ['0'], 2),
  commit('0', [], 1),
];

function snapshot(commits: GitCommit[], events: HistoryEvent[], reflogs: ReflogEntry[], tip: string): RepositorySnapshot {
  return {
    repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
    commits,
    refs: [
      { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('9') },
      { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid(tip) },
    ],
    workingTrees: [{
      worktreeId: 'worktree-0',
      path: 'C:/repo',
      headOid: oid(tip),
      branch: 'feature',
      detached: false,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      clean: true,
    }],
    operations: [],
    reflogs,
    historyEvents: events,
    shallowBoundaryOids: [],
    hasMore: false,
    visibleCommitCount: commits.length,
  };
}

describe('contiguous squash/fixup collapse', () => {
  it('detects 122-style squash: old [A,B], new S, suppresses generic Rebase', () => {
    const event = collapseEvent('b', 's', '9');
    const reflogs = contiguousCollapseReflogs('squash');
    const relations = buildRewriteCollapseRelations([event], new Map(contiguousCommits.map((item) => [item.oid, item])), { reflogs });
    expect(relations).toEqual([expect.objectContaining({
      kind: 'squash',
      oldOids: [oid('a'), oid('b')],
      newOid: oid('s'),
      oldTipOid: oid('b'),
      newTipOid: oid('s'),
      ontoOid: oid('9'),
      evidence: 'reflog',
    })]);

    const facts = buildGraphFacts(snapshot(contiguousCommits, [event], reflogs, 's'), { showReflog: true });
    expect(facts.rewriteCollapseRelations).toHaveLength(1);
    expect(facts.rewriteCollapseRelations![0]!.id).toBe(`rewrite-collapse:squash:refs/heads/feature:${oid('b')}:${oid('s')}`);
    expect(facts.rewriteCollapseRelations![0]!.id).not.toBe(event.id);
    expect(facts.rebaseRelations).toEqual([]);
    expect(facts.nodes.some((node) => node.kind === 'history-event' && node.event?.type === 'rebase')).toBe(false);
    expect(operationAnnotationLabel(facts.rewriteCollapseRelations![0]!)).toBe('Squash · feature: 2 commits → 1 commit');
  });

  it('detects 123-style fixup with oldest → newest old range', () => {
    const event = collapseEvent('b', 's', '9');
    const relations = buildRewriteCollapseRelations([event], new Map(contiguousCommits.map((item) => [item.oid, item])), {
      reflogs: contiguousCollapseReflogs('fixup'),
    });
    expect(relations[0]).toMatchObject({
      kind: 'fixup',
      oldOids: [oid('a'), oid('b')],
      newOid: oid('s'),
    });
  });

  it('does not treat 124 non-contiguous fixup as a dedicated Fixup overlay', () => {
    const event = collapseEvent('c', '2', '9');
    const reflogs = noncontiguousReflogs('fixup');
    const map = new Map(noncontiguousCommits.map((item) => [item.oid, item]));
    expect(buildRewriteCollapseRelations([event], map, { reflogs })).toEqual([]);

    const facts = buildGraphFacts(snapshot(noncontiguousCommits, [event], reflogs, '2'), { showReflog: true });
    expect(facts.rewriteCollapseRelations).toEqual([]);
    expect(facts.rebaseRelations).toEqual([]);
    expect(facts.nodes.some((node) => node.kind === 'history-event' && node.event?.type === 'rebase')).toBe(true);
    expect(facts.nodes.some((node) => node.oid === oid('a'))).toBe(true);
    expect(facts.nodes.some((node) => node.oid === oid('c'))).toBe(true);
  });

  it('does not treat 125 non-contiguous squash as a dedicated Squash overlay', () => {
    const event = collapseEvent('c', '2', '9');
    const facts = buildGraphFacts(snapshot(noncontiguousCommits, [event], noncontiguousReflogs('squash'), '2'), { showReflog: true });
    expect(facts.rewriteCollapseRelations).toEqual([]);
    expect(facts.rebaseRelations).toEqual([]);
    expect(facts.nodes.some((node) => node.kind === 'history-event' && node.event?.type === 'rebase')).toBe(true);
  });

  it('hides only the same-session pick that squash immediately replaced', () => {
    const event = collapseEvent('b', 's', '9');
    const reflogs = contiguousCollapseReflogs('squash');
    const map = new Map(contiguousCommits.map((item) => [item.oid, item]));
    const relations = buildRewriteCollapseRelations([event], map, { reflogs });
    const hidden = transientOidsForRewriteCollapse(relations, [event], reflogs, map, new Set([oid('s'), oid('9'), oid('0')]));
    expect([...hidden]).toEqual([oid('p')]);

    const facts = buildGraphFacts(snapshot(contiguousCommits, [event], reflogs, 's'), { showReflog: true });
    expect(facts.nodes.find((node) => node.oid === oid('p'))).toBeUndefined();
    expect(facts.nodes.find((node) => node.oid === oid('a'))).toBeDefined();
    expect(facts.nodes.find((node) => node.oid === oid('b'))).toBeDefined();
  });

  it('does not hide an unrelated UNREFERENCED commit', () => {
    const extra = [...contiguousCommits, commit('u', ['0'], 3)];
    const event = collapseEvent('b', 's', '9');
    const facts = buildGraphFacts(snapshot(extra, [event], contiguousCollapseReflogs('squash'), 's'), { showReflog: true });
    expect(facts.nodes.find((node) => node.oid === oid('u'))).toBeDefined();
    expect(facts.nodes.find((node) => node.oid === oid('p'))).toBeUndefined();
  });

  it('does not hide a pick when the following squash previousOid does not match', () => {
    const reflogs = [
      entry(0, 's', 's', 'rebase (finish): returning to refs/heads/feature', 20),
      entry(1, '9', 's', 'rebase (squash): Feature target A', 19),
      entry(2, '9', 'p', 'rebase (pick): Feature target A', 18),
      entry(3, 'b', '9', 'rebase (start): checkout main', 17),
    ];
    const event = collapseEvent('b', 's', '9');
    const map = new Map(contiguousCommits.map((item) => [item.oid, item]));
    const relations = buildRewriteCollapseRelations([event], map, { reflogs });
    const hidden = transientOidsForRewriteCollapse(relations, [event], reflogs, map, new Set([oid('s'), oid('9'), oid('0')]));
    expect(hidden.size).toBe(0);
  });

  it('hides squash/fixup overlays when reflog is off and leaves the current DAG', () => {
    const event = collapseEvent('b', 's', '9');
    const hidden = buildGraphFacts(snapshot(contiguousCommits, [event], contiguousCollapseReflogs('squash'), 's'), { showReflog: false });
    expect(hidden.rewriteCollapseRelations).toEqual([]);
    expect(hidden.nodes.find((node) => node.oid === oid('s'))?.kind).toBe('commit');
    expect(hidden.nodes.find((node) => node.oid === oid('9'))?.kind).toBe('commit');
    expect(hidden.nodes.some((node) => node.kind === 'history-event')).toBe(false);
    const layout = createGraphLayout(hidden, { visibleCommitCount: hidden.commits.length, hasMore: false });
    expect(layout.rewriteCollapsePaths).toEqual([]);
    expect(layout.operationAnnotationRows).toEqual([]);
  });

  it('does not outline onto or the transient pick in the old group', () => {
    const node = (id: string, row: number, lane: number): GraphNode => ({
      id: `commit:${oid(id)}`,
      kind: id === 'a' || id === 'b' ? 'reflog-commit' : 'commit',
      oid: oid(id),
      refIds: [],
      row,
      lane,
      subject: id,
    });
    const nodes = [node('s', 0, 0), node('9', 2, 0), node('b', 4, 1), node('a', 5, 1), node('0', 6, 0)];
    const relation: RewriteCollapseRelation = {
      id: 'history:rebase:1',
      kind: 'squash',
      refName: 'refs/heads/feature',
      oldOids: [oid('a'), oid('b')],
      newOid: oid('s'),
      oldTipOid: oid('b'),
      newTipOid: oid('s'),
      ontoOid: oid('9'),
      timestamp: 1,
      evidence: 'reflog',
    };
    const overlay = routeRewriteCollapseRelations(nodes, [relation]);
    expect(overlay.outlines).toHaveLength(1);
    expect(overlay.outlines[0]?.role).toBe('old');
    expect(overlay.paths).toHaveLength(1);
    expect(overlay.paths[0]?.kind).toBe('squash');
    expect(overlay.paths[0]?.targetNodeId).toBe(`commit:${oid('s')}`);
  });

  it('lists old commits without Mappings or individual arrows', () => {
    const relation: RewriteCollapseRelation = {
      id: 'history:rebase:1',
      kind: 'fixup',
      refName: 'refs/heads/feature',
      oldOids: [oid('a'), oid('b')],
      newOid: oid('s'),
      oldTipOid: oid('b'),
      newTipOid: oid('s'),
      timestamp: 1,
      evidence: 'reflog',
    };
    const list = overlayCommitList(relation)!;
    expect(list.heading).toBe('Old commits');
    expect(list.heading).not.toBe('Mappings');
    expect(list.rows.map((row) => [row.kind, row.leftLabel, row.leftOid, row.connector, row.rightOid])).toEqual([
      ['old-commit', '#1', oid('a'), 'none', ''],
      ['old-commit', '#2', oid('b'), 'none', ''],
    ]);
    const fields = overlayDetailFields(relation);
    expect(fields.find((field) => field.label === 'Operation')?.value).toBe('Fixup');
    expect(fields.find((field) => field.label === 'Branch / Ref')?.value).toBe('feature');
    expect(fields.find((field) => field.label === 'Rewrite')?.value).toBe('2 → 1');
    expect(fields.find((field) => field.label === 'Evidence')?.value).toBe('Reflog · rebase (fixup)');
    expect(fields.find((field) => field.label === 'New commit')?.value).toBe(oid('s').slice(0, 8));
    expect(fields.some((field) => field.label === 'Mappings')).toBe(false);
  });

  it('falls back when old members are not on the loaded page', () => {
    const loaded = contiguousCommits.filter((item) => item.oid !== oid('a'));
    const relations = buildRewriteCollapseRelations(
      [collapseEvent('b', 's', '9')],
      new Map(loaded.map((item) => [item.oid, item])),
      { reflogs: contiguousCollapseReflogs('squash') },
    );
    expect(relations).toEqual([]);
  });
});

describe('squash/fixup detail selection wiring', () => {
  it('selects RewriteCollapse squash detail instead of generic Rebase History Event', () => {
    const event = collapseEvent('b', 's', '9');
    const facts = buildGraphFacts(snapshot(contiguousCommits, [event], contiguousCollapseReflogs('squash'), 's'), { showReflog: true });
    const overlays = allOverlayRelations(facts);
    const relation = facts.rewriteCollapseRelations![0]!;
    const selected = resolveSelectedOperationDetail(relation.id, overlays, facts.events)!;
    expect(relation.id.startsWith('rewrite-collapse:squash:')).toBe(true);
    expect(selected.title).toBe('Squash · feature');
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Squash');
    expect(selected.fields.find((field) => field.label === 'Evidence')?.value).toBe('Reflog · rebase (squash)');
    expect(selected.fields.find((field) => field.label === 'Rewrite')?.value).toBe('2 → 1');
    expect(selected.commitList?.heading).toBe('Old commits');
    expect(selected.commitList?.rows).toHaveLength(2);
    expect(selected.fields.some((field) => field.label === 'Old tip')).toBe(false);
    expect(resolveSelectedOperationDetail(event.id, overlays, facts.events)?.title).not.toBe('Squash · feature');
  });

  it('selects Fixup collapse detail even if a generic rebase event is also passed', () => {
    const event = collapseEvent('b', 's', '9');
    const facts = buildGraphFacts(snapshot(contiguousCommits, [event], contiguousCollapseReflogs('fixup'), 's'), { showReflog: true });
    const relation = facts.rewriteCollapseRelations![0]!;
    const mixed = operationDetailContent(relation, event)!;
    expect(overlayDetailTitle(relation)).toBe('Fixup · feature');
    expect(mixed.title).toBe('Fixup · feature');
    expect(mixed.fields.find((field) => field.label === 'Operation')?.value).toBe('Fixup');
    expect(mixed.fields.find((field) => field.label === 'Evidence')?.value).toBe('Reflog · rebase (fixup)');
    expect(mixed.fields.find((field) => field.label === 'New commit')?.value).toBe(oid('s').slice(0, 8));
  });

  it('keeps squash/fixup selection keys distinct from generic rebase History Event ids', () => {
    const event = collapseEvent('b', 's', '9');
    const squashId = rewriteCollapseRelationId('squash', event.refName, event.fromOid!, event.toOid);
    const fixupId = rewriteCollapseRelationId('fixup', event.refName, event.fromOid!, event.toOid);
    expect(squashId).not.toBe(event.id);
    expect(fixupId).not.toBe(event.id);
    expect(squashId).not.toBe(fixupId);
    expect(squashId).toContain('rewrite-collapse:squash:');
  });

  it('keeps 124 generic Rebase History Event detail', () => {
    const event = collapseEvent('c', '2', '9');
    const facts = buildGraphFacts(snapshot(noncontiguousCommits, [event], noncontiguousReflogs('fixup'), '2'), { showReflog: true });
    const selected = resolveSelectedOperationDetail(event.id, allOverlayRelations(facts), facts.events)!;
    expect(facts.rewriteCollapseRelations).toEqual([]);
    expect(selected.title).toBe('Rebase · feature');
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Rebase');
    expect(selected.commitList).toBeUndefined();
  });

  it('keeps 125 generic Rebase History Event detail', () => {
    const event = collapseEvent('c', '2', '9');
    const facts = buildGraphFacts(snapshot(noncontiguousCommits, [event], noncontiguousReflogs('squash'), '2'), { showReflog: true });
    const selected = resolveSelectedOperationDetail(event.id, allOverlayRelations(facts), facts.events)!;
    expect(facts.rewriteCollapseRelations).toEqual([]);
    expect(selected.title).toBe('Rebase · feature');
    expect(selected.fields.find((field) => field.label === 'Operation')?.value).toBe('Rebase');
  });
});
