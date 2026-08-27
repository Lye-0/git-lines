import { afterEach, describe, expect, it } from 'vitest';
import { GitClient } from '../../src/git/gitClient.js';
import { commitFixture, createGitFixture } from '../fixtures/gitFixture.js';

describe('GitClient integration fixture', () => {
  let fixture: ReturnType<typeof createGitFixture> | undefined;
  afterEach(() => fixture?.dispose());

  it('reads an actual branching repository with a clean working tree', async () => {
    fixture = createGitFixture();
    commitFixture(fixture, 'base', '2026-08-27T09:00:00+09:00');
    fixture.run(['switch', '-c', 'feature/auth']);
    commitFixture(fixture, 'feature', '2026-08-27T10:00:00+09:00');
    fixture.run(['switch', 'main']);
    const snapshot = await new GitClient().readSnapshot(fixture.root, 30, true);
    expect(snapshot.commits.some((commit) => commit.subject === 'feature')).toBe(true);
    expect(snapshot.refs.some((ref) => ref.shortName === 'feature/auth' && ref.type === 'local')).toBe(true);
    expect(snapshot.workingTrees[0]).toMatchObject({ branch: 'main', clean: true });
    expect(snapshot.historyEvents.length).toBeGreaterThanOrEqual(1);
  });
});
