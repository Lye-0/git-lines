import { describe, expect, it } from 'vitest';
import type { GitCommit, HistoryEvent, ReflogEntry, RepositorySnapshot } from '../../src/git/gitTypes.js';
import { buildRewordRelations } from '../../src/model/rewordRelation.js';
import { buildGraphFacts } from '../../src/model/graphBuilder.js';
import { createGraphLayout } from '../../src/layout/graphLayout.js';
import { allOverlayRelations } from '../../src/model/graphModel.js';
import { operationAnnotationLabel, operationKindLabel, operationOverlayColor } from '../../webview/src/components/operationPresentation';
import { resolveSelectedOperationDetail } from '../../webview/src/components/overlayDetailPresentation';

const oid = (c: string) => c.repeat(40);
function fixture() {
  const commits: GitCommit[] = [['0', ''], ['9', '0'], ['a', '0'], ['b', 'a'], ['c', 'b'], ['1', '9'], ['4', '1'], ['2', '1'], ['3', '2']]
    .map(([id, parent], index) => ({ oid: oid(id), parentOids: parent ? [oid(parent)] : [], subject: 'same message', authorName: 'A', authorDate: index, committerName: 'A', committerDate: index }));
  const event: HistoryEvent = { id: 'session', type: 'rebase', fromOid: oid('c'), toOid: oid('3'), boundaryOid: oid('9'), refName: 'refs/heads/feature', timestamp: 20, subject: `rebase (finish): refs/heads/feature onto ${oid('9')}` };
  const reflogs: ReflogEntry[] = [
    ['c', '9', 'rebase (start): checkout main'],
    ['9', '1', 'rebase (pick): same'],
    ['1', '4', 'rebase (reword): same'],
    ['4', '2', 'rebase (reword): same'],
    ['2', '3', 'rebase (pick): same'],
    ['3', '3', 'rebase (finish): returning to refs/heads/feature'],
  ].reverse().map(([old, next, subject], index) => ({ previousOid: oid(old), newOid: oid(next), subject, refName: 'HEAD', selector: `HEAD@{${index}}`, timestamp: 20 }));
  const snapshot: RepositorySnapshot = {
    repository: { root: 'C:/repo', gitDir: 'C:/repo/.git', commonGitDir: 'C:/repo/.git', bare: false, shallow: false, linkedWorktree: false },
    commits, refs: [{ fullName: 'refs/heads/feature', shortName: 'feature', type: 'local', oid: oid('3') }, { fullName: 'refs/heads/main', shortName: 'main', type: 'local', oid: oid('9') }],
    workingTrees: [], operations: [], reflogs, historyEvents: [event], shallowBoundaryOids: [], hasMore: false, visibleCommitCount: commits.length,
  };
  return { snapshot, event, reflogs, commits: new Map(commits.map((c) => [c.oid, c])) };
}

describe('local Reword relation', () => {
  it('RWD1–RWD7 / RWD10 uses only T→B-prime, keeps generic Rebase and historical classification, and renders Reword Detail', () => {
    const f = fixture();
    const facts = buildGraphFacts(f.snapshot, { showReflog: true });
    const [relation] = facts.historyRelations!;
    expect(facts.historyRelations).toHaveLength(1);
    expect(relation).toMatchObject({ kind: 'reword', sourceOid: oid('4'), targetOid: oid('2'), evidence: 'reflog' });
    expect(relation.sourceOid).not.toBe(oid('1'));
    expect(relation.sourceOid).not.toBe(oid('b'));
    expect(facts.rebaseRelations).toEqual([]);
    expect(facts.nodes.filter((n) => n.event).map((n) => n.event?.type)).toEqual(['rebase']);
    expect(facts.nodes.find((n) => n.oid === oid('4'))).toMatchObject({ kind: 'reflog-commit', previousRoute: false, historicalKind: 'unreferenced' });
    const baseline = buildGraphFacts({ ...f.snapshot, reflogs: [] }, { showReflog: true });
    expect(facts.edges).toEqual(baseline.edges);
    const layout = createGraphLayout(facts, { visibleCommitCount: f.snapshot.visibleCommitCount, hasMore: false });
    // Retain identical historical evidence when isolating overlay placement.
    const baselineLayout = createGraphLayout({ ...facts, historyRelations: [] }, { visibleCommitCount: f.snapshot.visibleCommitCount, hasMore: false });
    expect(layout.nodes.map((n) => [n.id, n.lane])).toEqual(baselineLayout.nodes.map((n) => [n.id, n.lane]));
    expect(layout.historyRelationPaths).toHaveLength(1);
    expect(layout.historyRelationPaths![0]).toMatchObject({ kind: 'reword', sourceNodeId: `commit:${oid('4')}`, targetNodeId: `commit:${oid('2')}`, arrowD: expect.stringContaining('M') });
    expect(layout.operationAnnotationRows).toHaveLength(1);
    expect(operationKindLabel(relation.kind)).toBe('Reword');
    expect(operationAnnotationLabel(relation)).toBe(`Reword · feature: ${oid('4').slice(0, 8)} → ${oid('2').slice(0, 8)}`);
    expect(operationOverlayColor(relation.kind)).toBe('var(--operation-overlay-accent)');
    const detail = resolveSelectedOperationDetail(relation.id, allOverlayRelations(facts), facts.events)!;
    expect(detail.title).toBe('Reword · feature');
    expect(detail.fields).toContainEqual(expect.objectContaining({ label: 'Old commit', title: oid('4') }));
    expect(detail.fields).toContainEqual(expect.objectContaining({ label: 'New commit', title: oid('2') }));
    expect(detail.fields).toContainEqual({ label: 'Evidence', value: 'Reflog · rebase (reword)' });
    expect(detail.commitList).toBeUndefined();
    expect(detail.orderedLists).toEqual([]);
  });

  it('RWD8 shows Current DAG only with reflog off', () => {
    const facts = buildGraphFacts(fixture().snapshot, { showReflog: false });
    expect(allOverlayRelations(facts)).toEqual([]);
    expect(facts.nodes.some((n) => n.event || n.kind === 'reflog-commit')).toBe(false);
    expect(facts.nodes.some((n) => n.oid === oid('2'))).toBe(true);
  });

  it.each(['missing-first', 'missing-second', 'no-start', 'no-finish', 'broken-transition', 'wrong-parent', 'missing-object', 'duplicate-selector', 'competing-finish', 'three-rewords', 'wrong-ref', 'wrong-old-tip', 'same-oid', 'ordinary-picks', 'in-progress'])(
    'RWD9 / RWD10 withholds ambiguous or incomplete evidence: %s', (condition) => {
      const f = fixture();
      switch (condition) {
        case 'missing-first': f.reflogs.splice(3, 1); break;
        case 'missing-second': f.reflogs.splice(2, 1); break;
        case 'no-start': f.reflogs.pop(); break;
        case 'no-finish': f.reflogs.shift(); break;
        case 'broken-transition': f.reflogs[2].previousOid = oid('b'); break;
        case 'wrong-parent': f.commits.get(oid('2'))!.parentOids = [oid('4')]; break;
        case 'missing-object': f.commits.delete(oid('4')); break;
        case 'duplicate-selector': f.reflogs.push({ ...f.reflogs[2] }); break;
        case 'competing-finish': f.reflogs.push({ ...f.reflogs[0], selector: 'HEAD@{20}' }); break;
        case 'three-rewords': f.reflogs[1].subject = 'rebase (reword): same'; break;
        case 'wrong-ref': f.reflogs[0].subject = 'rebase (finish): returning to refs/heads/other'; break;
        case 'wrong-old-tip': f.event.fromOid = oid('b'); break;
        case 'same-oid': f.reflogs[2].newOid = oid('4'); f.reflogs[1].previousOid = oid('4'); break;
        case 'ordinary-picks': f.reflogs.forEach((e) => { e.subject = e.subject.replace('(reword)', '(pick)'); }); break;
        case 'in-progress': f.snapshot.operations.push({ type: 'rebase', sourceOids: [oid('b')] }); break;
      }
      expect(buildRewordRelations([f.event], f.commits, f.reflogs, f.snapshot.operations)).toEqual([]);
    });
});
