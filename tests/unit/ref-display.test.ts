import { describe, expect, it } from 'vitest';
import { branchFamilyForRef, isUserFacingRef, normalizeRefName, toGraphRefBadge, uniqueGraphRefBadges } from '../../src/model/refDisplay.js';

describe('ref display model', () => {
  it('normalizes heads, remote-tracking refs, and tags for UI labels', () => {
    expect(normalizeRefName('refs/heads/main')).toBe('main');
    expect(normalizeRefName('refs/remotes/origin/feature/login')).toBe('origin/feature/login');
    expect(normalizeRefName('refs/tags/v1.0.0')).toBe('v1.0.0');
  });

  it('keeps symbolic remote HEAD and pseudo refs out of user-facing branch badges', () => {
    const remoteHead = { fullName: 'refs/remotes/origin/HEAD', shortName: 'origin/HEAD', type: 'symbolic' as const, oid: 'a'.repeat(40), targetRef: 'refs/remotes/origin/main' };
    const origHead = { fullName: 'ORIG_HEAD', shortName: 'ORIG_HEAD', type: 'symbolic' as const, oid: 'a'.repeat(40) };
    expect(isUserFacingRef(remoteHead)).toBe(false);
    expect(isUserFacingRef(origHead)).toBe(false);
    expect(toGraphRefBadge(remoteHead)).toMatchObject({ name: 'origin/HEAD', kind: 'special' });
  });

  it('uses the canonical remote name to resolve a shared branch family', () => {
    const local = { fullName: 'refs/heads/feature', shortName: 'feature', type: 'local' as const };
    const alice = { fullName: 'refs/remotes/alice/feature', shortName: 'alice/feature', type: 'remote' as const };
    const bob = { fullName: 'refs/remotes/bob/feature', shortName: 'bob/feature', type: 'remote' as const };
    const localSlashBranch = { fullName: 'refs/heads/alice/feature', shortName: 'alice/feature', type: 'local' as const };

    expect(branchFamilyForRef(local)).toBe('feature');
    expect(branchFamilyForRef(alice)).toBe('feature');
    expect(branchFamilyForRef(bob)).toBe('feature');
    expect(branchFamilyForRef(localSlashBranch)).toBe('alice/feature');
  });

  it('prioritizes the checked-out branch and corresponding remote before tags', () => {
    const refs = [
      { fullName: 'refs/tags/v1.0.0', shortName: 'v1.0.0', type: 'tag' as const, oid: 'a'.repeat(40) },
      { fullName: 'refs/remotes/origin/main', shortName: 'origin/main', type: 'remote' as const, oid: 'a'.repeat(40), isDefault: true },
      { fullName: 'refs/heads/other', shortName: 'other', type: 'local' as const, oid: 'a'.repeat(40) },
      { fullName: 'refs/remotes/origin/feature/login', shortName: 'origin/feature/login', type: 'remote' as const, oid: 'a'.repeat(40) },
      { fullName: 'refs/heads/feature/login', shortName: 'feature/login', type: 'local' as const, oid: 'a'.repeat(40) },
    ];
    expect(uniqueGraphRefBadges(refs.map(toGraphRefBadge), 'feature/login').map((badge) => badge.name)).toEqual([
      'feature/login',
      'other',
      'origin/feature/login',
      'origin/main',
      'v1.0.0',
    ]);
  });

  it('keeps every normal ref badge in the model when one commit has many refs', () => {
    const badges = Array.from({ length: 24 }, (_, index) => toGraphRefBadge({
      fullName: `refs/heads/ref-branch-${String(index + 1).padStart(2, '0')}`,
      shortName: `ref-branch-${String(index + 1).padStart(2, '0')}`,
      type: 'local',
      oid: 'a'.repeat(40),
    }));
    const result = uniqueGraphRefBadges(badges);
    expect(result).toHaveLength(24);
    expect(result.every((badge) => badge.name.startsWith('ref-branch-'))).toBe(true);
    expect(result.map((badge) => badge.name)).toContain('ref-branch-24');
  });
});
