---
id: rm-20260915-shared-tip-route-continuity
topic: graph-routing
type: failure
status: active
maturity: candidate
created: 2026-09-15
last_verified: 2026-09-15
source_commit: "98cd4e4"
related_files:
  - src/model/sharedTipRouteContinuity.ts
  - src/layout/laneLayout.ts
  - src/git/gitClient.ts
  - tests/integration/shared-tip-continuity.test.ts
  - docs/design/shared-tip-route-continuity-verification.md
tags:
  - shared-tip
  - continuity
  - pagination
---

# Preserving edges alone does not preserve a branch route at a shared tip

## Conclusion

113 exposed main owning unknown M1/A2 while proven A1 stayed feature-a. The fix preserves a complete first-parent continuation from the shared tip to the source ref's proven previous tip, including that anchor. This is display-route continuity, not evidence that every intermediate commit was created on that branch. Foreign/conflicting creation evidence wins; do not invent a main parent edge to make its column continuous.

## Scope

Current shared local tips with a reliable previous OID and a proven source anchor. Incomplete, expired or ambiguous evidence must not claim a range. Normal commit/merge creation and existing FF protection remain authoritative.

## Evidence

459 tests pass. The real-Git commit-tree test asserts A1/M1/A2 route names and lanes, all parents, main's badge/Working Tree target and refresh. In the 1,104-condition comparison only 113 changed. A separate failure was found with very small pages: evidence must be independent of visible commits to avoid later relabeling. Bounded route metadata fixes the tested 2/4/8/16 sequence without enlarging the graph page. New Working Tree diagonals also require obstacle checks against unrelated sibling nodes.

## Verification

Run shared-tip unit/integration tests, the full suite and the comparison against 98cd4e4. Check labels and the Working Tree connection in addition to edge completeness. Distinguish the tested bounded continuation from a guarantee for arbitrarily long or missing history.
