---
id: rm-20260912-history-cache-measurement
topic: git-history-pagination
type: constraint
status: active
maturity: candidate
created: 2026-09-12
last_verified: 2026-09-12
source_commit: "e6174aaac6eced24c563fe895a0592023a08b3a9"
related_files:
  - src/git/gitClient.ts
  - src/webview/graphViewSession.ts
  - docs/technical/history-performance.md
  - tests/integration/reflog-pagination.test.ts
tags:
  - performance
  - cache
  - invalidation
---

# Separate first-open cost from validated cache reuse

## Conclusion

Warm history-cache gains do not demonstrate faster first opening. Measure initial, append and unchanged reads separately, including Git process counts and Webview acknowledgement. Current reuse validates refs, HEAD and shallow state, anchors prospective pages to immutable tip OIDs, and restarts on identity changes. Density reuses the snapshot; mutable working state remains freshly read. Manual refresh bypasses caches, and in-flight watcher notifications must be replayed after the current read rather than discarded.

## Scope

GitClient and GraphViewSession performance changes. Do not substitute indefinite whole-snapshot caching, hide historical operations, infer paint completion from postMessage, or expose an arbitrary truncation as a performance improvement. Cache size limits control retention rather than history semantics.

## Evidence

- Three-run read-only medians with Reflog ON reduced append from 4,851 to 638 ms and unchanged reads from 4,820 to 335 ms; initial remained approximately 4.6–4.8 seconds. GUI rendering was excluded.
- Integration tests compare cached and fresh pages across multiple refs, annotated tags and detached HEAD; moved HEAD and expired Reflog tests verify invalidation.
- Session tests verify zero Git reads on Density changes, preserved Detail and coalesced pending updates, including force refresh during a read.
- Canonical measurement definitions, retention limits and before/after results are in docs/technical/history-performance.md.

## Verification

Run reflog-pagination integration and graph-view-hosts unit tests. Compare initial and warm phases on the same repository with no simultaneous test/build load. Check command counts, cache invalidation and actual graph semantics as well as elapsed time.
