---
id: rm-20260912-historical-boundary-lane
topic: git-history-pagination
type: failure
status: active
maturity: candidate
created: 2026-09-12
last_verified: 2026-09-12
source_commit: "5a8dba688938707ea2edf0937710807be4d02069"
related_files:
  - src/layout/laneLayout.ts
  - src/layout/edgeRouter.ts
  - tests/unit/pagination-layout.test.ts
tags:
  - historical
  - boundary
  - lane
---

# Unclaimed historical boundaries cause false main joins and oversized curves

## Conclusion

Historical route membership includes loaded reflog commits, not unread-parent stubs. An unclaimed stub previously fell back to lane 0 while its child remained on a side lane. The resulting cross-lane parent curve intersected live commits, and the router shifted both controls outward until the entire curve cleared them. Fix the unclaimed boundary track before changing collision avoidance: inherit an incoming child's track only when no existing track or ancestry claim exists. Shared stubs prefer the nearest child row, then ID; parent identity and edges remain intact.

## Scope

Unclaimed OID-bearing history boundaries on paginated historical routes. Do not override known live/shared ancestry, reassign loaded parents to a historical track, or remove DAG obstacle avoidance. This does not eliminate every possible long-curve bulge.

## Evidence

- Read-only real-repository replay at 30/40/50 commits changed the historical parent route from lane 2→0 to lane 2→2; all four cubic X coordinates became 92. Target Git metadata and worktree status were unchanged.
- Pagination layout tests cover unreferenced, deleted-branch and previous routes, sampled curve positions, unchanged parent edges, and a loaded parent assigned by main ancestry.

## Verification

Run pagination-layout, layout and dag-node-avoidance tests. Compare boundary track claims with incoming child claims before attributing a bulge solely to edgeRouter. Verify the eventual loaded parent can follow live ancestry.
