---
id: rm-20260912-reflog-page-boundary
topic: git-history-pagination
type: failure
status: active
maturity: candidate
created: 2026-09-12
last_verified: 2026-09-12
source_commit: "24f5702b3f15a204128dcd2b1300babeb9b3f9ca"
related_files:
  - src/git/gitClient.ts
  - src/model/graphBuilder.ts
  - tests/integration/reflog-pagination.test.ts
  - docs/technical/graph-architecture.md
tags:
  - reflog
  - pagination
  - performance
---

# Reflog evidence must not expand the live graph page

## Conclusion

`git log -n` and `visibleCommitCount` alone do not bound the displayed graph. `GitClient.readSnapshot` also collects reflog objects and ancestors for evidence. Appending that entire collection in `buildGraphFacts` made an initial 30-commit request display old live ancestry too. Keep the complete evidence map for reachability and ref classification, but include live commit nodes only from the visible prefix. Retain historical nodes and use boundary nodes for parents outside the page.

## Scope

Applicable: Reflog ON, changes to snapshot evidence loading, graph selection, pagination, or initial-load performance.

Do not apply: interpreting the evidence-object count as a display count, removing historical relations to enforce a total 30-node limit, or replacing proven parent edges with guessed connections.

## Evidence

- `readSnapshot` obtains the limited live prefix before adding reflog objects. The former one-object-per-process traversal was the dominant measured cost; batches now contain at most 64 OIDs and reuse already loaded commits.
- A local 30-commit comparison produced 89 snapshot commits and 59 `git show` calls before the fix, versus 30 live nodes and one `git show` after it. Timing is machine-dependent and is not a performance guarantee.
- `tests/integration/reflog-pagination.test.ts` uses real Git history to verify 30→40 live nodes, retained Amend evidence, bounded command counts, and isolation of a missing object.
- The existing one-commit Amend integration case now verifies two parent edges to a page boundary instead of pulling the live base commit onto the page.

## Verification

1. Compare requested limit, visible prefix, total evidence count, and actual live node count independently.
2. Check current-ref reachability against the evidence map, not only the displayed nodes.
3. Run `pnpm exec vitest run tests/integration/reflog-pagination.test.ts tests/unit/graph-builder.test.ts` and the existing operation integration tests.
4. Measure Git process count as well as elapsed time; a short page can still trigger expensive evidence collection.
