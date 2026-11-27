---
id: rm-20261128-reflog-row-cache-order
topic: git-history-pagination
type: failure
status: active
maturity: candidate
created: 2026-11-28
last_verified: 2026-11-28
source_commit: "3232f0d134828161abd95dec51fc0e9e7bec839a"
related_files:
  - src/layout/rowLayout.ts
  - src/layout/layoutState.ts
  - tests/unit/row-cache-order.test.ts
  - tests/integration/row-cache-pagination.test.ts
  - docs/technical/graph-architecture.md
tags:
  - reflog
  - pagination
  - row-cache
  - topological-order
---

# Promoting reflog ancestors can invalidate cached timeline rows

## Conclusion

A partial live page can contain older reflog-only ancestors across an unread gap.
When an appended page fills that gap and promotes ancestors to current commits,
keeping their earlier rows can place a new child below its parent. The router then
correctly connects misplaced endpoints with long detours; changing its geometry
alone would hide the row-order failure. After assigning structural rows, validate
all parent, Working Tree and operation constraints. If reused rows violate one,
recompute without both previousRows and embedded node.row values, including ref
events. Normal valid appends continue to reuse their coordinates.

## Scope

Cached structural rows that conflict with newly loaded relationships. Lane
algorithms, Git evidence loading, parent arrays and refs are unchanged. This is
separate from an unclaimed history-boundary lane or a legitimate long parent edge.
A corrective reflow may move existing rows; DAG validity takes precedence over
keeping an invalid timeline stable.

## Evidence

- Before the fix, generic unit cases with an unread bridge and promoted ancestors
  fail parent-order invariants, both with and without a separate ref event.
- A temporary nine-commit Git repository with a gap in its reflog reproduces the
  failure on a 3-to-8 commit append; Standard and Default Fixed, Reflog ON/OFF,
  and the final nine-commit page pass with the fix.
- Read-only real-history replay at 30/40/50/60 commits preserves parent ordering
  in both modes with Reflog ON/OFF. Previously reversed same-lane connectors no
  longer need to bypass intervening commits.
- Tests cover embedded row values, all three structural edge types, immutable
  input facts, ref-event reinsertion, and subsequent normal append stability.

## Verification

Run row-cache-order, row-cache-pagination, pagination-layout, layout-state and
layout tests, then pnpm check. For a visual report, compare current node rows with
real parents before changing lanes or routing. Do not expire saved fixture or
user repository reflogs to reproduce this; use an independent temporary repo.
