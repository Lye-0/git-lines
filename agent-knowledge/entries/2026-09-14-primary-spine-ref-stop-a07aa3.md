---
id: rm-20260914-primary-spine-ref-stop
topic: graph-routing
type: constraint
status: active
maturity: candidate
created: 2026-09-14
last_verified: 2026-09-14
source_commit: "a07aa3c7dd8db2f4382f2bf0d6e98297485cc5ff"
related_files:
  - src/layout/laneLayout.ts
  - tests/unit/layout.test.ts
  - webview/src/components/routePresentation.ts
  - docs/design/primary-lane-impact-review.md
tags:
  - primary
  - first-parent
  - ref-tip
---

# Removing primary ref-tip stops conflicts with existing route ownership

## Conclusion

The primary first-parent walk stops before a non-primary ref tip. This is not evidence of a merge from main into another branch. Omitting that stop restores a continuous primary spine but changes an existing feature-route ownership expectation. Treat this as a display-contract change, not just an edge-routing fix or reconstruction of historical branch names.

## Scope

Primary ancestry with another branch or remote-tracking tip on that first-parent chain. The user wants main to stay left when receiving merges, but does not require it to stay left when merged into another branch. Do not reinterpret this as ownership of all reachable ancestors or automatic permission to change existing feature/event display contracts.

The user clarified that independence includes a physically separate column: a feature Working Tree before its first commit, and identifiable feature commits after a fast-forward into an unchanged main, must not enter the default column while sufficient reflog evidence remains. Keeping colors or track IDs while moving those nodes to lane 0 does not satisfy this constraint. The separate fixed mode now preserves these constraints through branchCommitOrigins and defaultFixedLayout. Its real-Git tests cover zero-commit checkout, FF, deletion, later main commits and independent linked-worktree HEAD evidence. The rejected one-call variant in this review remains unadopted.

## Evidence

- Isolated candidate omitted the third argument of the primary firstParentChain call. Existing suite: 412/413 pass. Baseline layout tests: 39/39 pass.
- The failing test is `keeps feature history on its own lane while anchoring ref events to the destination`: a mid-chain feature commit moves from lane 1 to 0; event placement expectations still pass.
- Read-only comparison of 92 repositories at six presentation/Reflog combinations changed only the reported repository. In-memory extra tip anchors exercised 68 repositories and also moved operation paths without changing their relations or counts.
- Track changes can change colors and Branch / Route labels in both rows and Detail. Full results and limitations are in the linked impact review; candidate was not adopted.

## Verification

The real-Git fixture `141-default-fast-forward` exposed a distinct shared-tip exception: legacy Standard claims both feature-created commits as main after FF, despite intact creation reflogs. Do not cite the older mid-chain-ref test as proof of universal source-column independence. The user explicitly authorized correcting FF in both modes. `fastForwardLayout` now protects proven imported source commits before optional default pinning; `tests/integration/fast-forward-placement.test.ts` checks both modes, Reflog ON/OFF, source deletion, later main commits, route labels and connected FF annotation endpoints. This targeted FF correction does not adopt the rejected unrestricted first-parent-walk change.

Re-run baseline layout tests and the full suite with the isolated one-call variant. Compare facts and layouts from identical snapshots, including stale mid-chain refs, both merge directions, pagination and operation overlays. Verify GUI separately; passing DAG geometry checks does not prove operation labels or popovers remain usable.
