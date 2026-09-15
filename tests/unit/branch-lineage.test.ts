import { describe, expect, it } from 'vitest';
import { branchLineage, sourcePrimaryBranch } from '../../src/model/branchLineage.js';
import { sourceTrackParents } from '../../src/layout/sourceBranchLayout.js';
import type { GitRef, ReflogEntry } from '../../src/git/gitTypes.js';

const log = (refName: string, subject: string): ReflogEntry => ({ refName, subject, timestamp: 1, newOid: 'base', previousOid: 'base', selector: `${refName}@{0}` });
const ref = (name: string): GitRef => ({ fullName: `refs/heads/${name}`, shortName: name, type: 'local', oid: 'base' });

describe('source branch evidence', () => {
  it('keeps explicit sources and branch names containing slashes', () => {
    const relations = branchLineage([log('refs/heads/feature/topic', 'branch: Created from release/base')]);
    expect(relations).toEqual([{ parent: 'release/base', child: 'feature/topic', base: 'base' }]);
    const refs = [ref('release/base'), ref('feature/topic')];
    expect(sourcePrimaryBranch(refs, 'feature/topic', relations)).toBe('release/base');
    expect(sourcePrimaryBranch(refs, 'feature/topic', relations, 'feature/topic')).toBe('feature/topic');
  });
  it('accepts a unique HEAD checkout but refuses shared-tip and conflicting evidence', () => {
    const created = log('refs/heads/child', 'branch: Created from HEAD');
    const checkout = log('HEAD', 'checkout: moving from main to child');
    expect(branchLineage([created, checkout])).toHaveLength(1);
    expect(branchLineage([checkout])).toEqual([]);
    expect(branchLineage([created, checkout, log('HEAD', 'checkout: moving from other to child')])).toEqual([]);
    expect(branchLineage([created, checkout, log('refs/heads/main', 'commit: base'), log('refs/heads/sibling', 'branch: Created from main')]).some((r) => r.child === 'child')).toBe(false);
  });
  it('does not promote revisions, recreated conflicting names, cyclic or diverged families', () => {
    expect(branchLineage([log('refs/heads/child', 'branch: Created from main~1')])).toEqual([]);
    expect(branchLineage([log('refs/heads/child', 'branch: Created from main'), log('refs/heads/child', 'branch: Created from other')])).toEqual([]);
    const tracks = [{ id: 'main', family: 'main' }, { id: 'child', family: 'child' }];
    const cycle = [{ parent: 'main', child: 'child', base: 'a' }, { parent: 'child', child: 'main', base: 'b' }];
    expect(sourceTrackParents(tracks, cycle).size).toBe(0);
    expect(sourcePrimaryBranch([ref('leaf'), ref('main'), ref('child')], 'leaf', [...cycle, { parent: 'main', child: 'leaf', base: 'c' }])).toBe('leaf');
    expect(sourceTrackParents([...tracks, { id: 'remote-main', family: 'main' }], [cycle[0]]).size).toBe(0);
  });
});
