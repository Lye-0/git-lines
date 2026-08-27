import { describe, expect, it } from 'vitest';
import { resolveHistoryEvents } from '../../src/model/historyEventResolver.js';
import type { GitCommit, ReflogEntry } from '../../src/git/gitTypes.js';

const oid = (letter: string) => letter.repeat(40);
const commits: GitCommit[] = [
  { oid: oid('a'), parentOids: [], subject: 'base', authorName: 'A', authorDate: 1, committerName: 'A', committerDate: 1 },
  { oid: oid('b'), parentOids: [oid('a')], subject: 'feature', authorName: 'A', authorDate: 2, committerName: 'A', committerDate: 2 },
];
const entry = (subject: string, from: string, to: string): ReflogEntry => ({ refName: 'refs/heads/main', newOid: to, previousOid: from, selector: 'main@{0}', timestamp: 3, subject });

describe('history event resolver', () => {
  it('only calls a ref move fast-forward when the reflog says so and ancestry proves it', () => {
    expect(resolveHistoryEvents([entry('merge feature: Fast-forward', oid('a'), oid('b'))], commits)[0].type).toBe('fast-forward');
    expect(resolveHistoryEvents([entry('update', oid('b'), oid('a'))], commits)[0].type).toBe('generic-ref-move');
  });

  it('classifies explicit reset/amend/rebase actions without guessing from patch similarity', () => {
    expect(resolveHistoryEvents([entry('reset: moving to HEAD~1', oid('b'), oid('a'))], commits)[0].type).toBe('reset');
    expect(resolveHistoryEvents([entry('commit (amend): fix', oid('a'), oid('b'))], commits)[0].type).toBe('amend');
    expect(resolveHistoryEvents([entry('rebase (finish): refs/heads/main', oid('b'), oid('a'))], commits)[0].type).toBe('rebase');
  });
});
