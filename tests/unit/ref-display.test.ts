import { describe, expect, it } from 'vitest';
import { isUserFacingRef, normalizeRefName, toGraphRefBadge, uniqueGraphRefBadges } from '../../src/model/refDisplay.js';

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
});
