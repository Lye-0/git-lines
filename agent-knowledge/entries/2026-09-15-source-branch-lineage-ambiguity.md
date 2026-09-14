---
id: rm-20260915-source-branch-lineage-ambiguity
topic: graph-routing
type: constraint
status: active
maturity: candidate
created: 2026-09-15
last_verified: 2026-09-15
source_commit: "22ccb2ff8b7885f262427c8924b7f1e35cdd9fe5"
related_files:
  - src/model/branchProtection.ts
  - src/model/graphBuilder.ts
  - src/layout/laneLayout.ts
  - research/lineage/prototype.mjs
  - docs/design/source-branch-layout-verification.md
tags:
  - lineage
  - reflog
  - ambiguity
  - source-branch
---

# Equal reflog evidence can hide different branch-creation contexts

## Conclusion

The requested Standard policy preserves a source branch to the left of a new branch before merging and after new→source merges, including non-default and nested branches. Checkout or local-ref deletion alone must not flip that relation. A commit's route identity and shared fork base must be decided before optional default pinning. Fixture 148's old behavior is not a valid intended mode difference.

Even intact reflogs cannot always prove the source branch name. Creating `child HEAD` before versus after switching main→sibling at a shared tip, within one second, can leave identical refs and parsed reflogs. OID/timestamp correlation with a later checkout is insufficient when multiple source refs are possible.

## Scope

This is a user constraint and an evidence limitation, not a claim that the experimental lineage allocator has been adopted. Explicit `Created from <branch>` records can provide stronger evidence. Commit origin and branch creation context are distinct; a shared/FF tip is not unique ownership.

## Evidence

The verification-only prototype and real-Git audit in `research/lineage/` reproduce the indistinguishable two-repo case and conservatively withhold an inferred parent. The final prototype passes 168 focused layouts, 437 existing tests, 18 evidence checks and 30 pagination stages. The 1,104-layout cached matrix still has three visible changes; see the report for scope and limitations. Product source remains unchanged.

## Verification

Run the research audit against the saved snapshot directory and the research Vitest config. Inspect `creation-before-vs-after-switch` for equal evidence and no inferred child parent. Re-evaluate constraints before adopting a production lineage model; do not treat these passing tests as a guarantee of unchanged GUI behavior.
