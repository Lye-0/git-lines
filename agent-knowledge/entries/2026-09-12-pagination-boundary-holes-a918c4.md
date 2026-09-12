---
id: rm-20260912-pagination-boundary-holes
topic: git-history-pagination
type: failure
status: active
maturity: candidate
created: 2026-09-12
last_verified: 2026-09-12
source_commit: "dbbb26568ef2526bf766da7b3c4305e53be07150"
related_files:
  - src/layout/layoutState.ts
  - src/layout/rowLayout.ts
  - src/model/graphBuilder.ts
  - src/webview/graphViewSession.ts
  - tests/unit/pagination-layout.test.ts
tags:
  - pagination
  - boundary
  - row-gaps
---

# Replacing pagination boundaries leaves stale row reservations

## Conclusion

Fixed by treating history-boundary rows as temporary rather than pinned rows. Previously, `LayoutState.set` stored placeholders along with real commits, and append started after the maximum surviving row. A boundary and its eventual commit have different IDs (`boundary:<oid>` versus `commit:<oid>`), so replacing one left holes held open by other boundary rows. `LayoutState` now excludes boundary rows, and `computeRowLayout` ignores prior boundary row assignments. It also releases outgoing constraints from already assigned nodes before sorting the new page, preserving child-before-parent order even with skewed commit dates.

## Scope

Applicable: incremental history loading, especially when several branches have unread parents. Distinguish temporary boundary nodes from real commit positions when investigating or fixing row reuse.

Do not apply: deliberate Operation Annotation Rows, rows occupied by actual commits on another lane, or a fresh layout without previousRows. Do not fix this by changing parent relationships or deleting historical operations.

## Evidence

- A read-only real-repository replay placed adjacent Git parent/child commits at rows 31 and 32 when opening 40 commits directly.
- Opening 30 then appending to 40 placed them at rows 31 and 35. Row 32 was empty; rows 33 and 34 still held boundary placeholders.
- Continuing through 50 to 60 removed the remaining placeholders but left all three rows 32–34 empty. No Operation Annotation Rows were present in this reproduction.
- `graphBuilder` replaces the boundary ID when the actual parent becomes visible; `rowLayout` only reuses matching IDs and computes its next row from the largest surviving row.
- Target repository Git metadata contents and worktree status were unchanged before/after the read-only investigation.
- After the fix, the same read-only 30→40→50→60 replay keeps the pair at rows 31 and 32, with no intervening gap; Git metadata and status remain unchanged.
- `tests/unit/pagination-layout.test.ts` covers three disappearing boundaries across repeated appends, stable real commit rows/lanes, unchanged parent edges, annotation gaps, and skewed dates.

## Verification

1. Build initial and expanded snapshots; compare a fresh expanded layout with an append using `LayoutState.rows/lanes/nodeLanes`.
2. Inspect removed boundary IDs, the same-OID real commit IDs, and unused row numbers after multiple page appends.
3. A fix should preserve actual commit positions/parent edges while replacing or relocating temporary boundary reservations. Check multiple branches, annotation rows, and repeated appends; simply removing every existing row would discard the stable-layout contract.
