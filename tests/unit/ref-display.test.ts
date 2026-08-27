import { describe, expect, it } from 'vitest';
import { isUserFacingRef, normalizeRefName, toGraphRefBadge } from '../../src/model/refDisplay.js';

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
});
