---
id: rm-20260912-object-reader-process-reuse
topic: git-history-pagination
type: pattern
status: active
maturity: candidate
created: 2026-09-12
last_verified: 2026-09-12
source_commit: "ff5e784004a5e51f94b82ac3a1ab16d8e24ed978"
related_files:
  - src/git/gitClient.ts
  - src/git/objectReader.ts
  - src/git/parsers/commitObjectParser.ts
  - tests/integration/commit-objects.test.ts
tags:
  - performance
  - evidence
  - cat-file
---

# Reuse the object process across ancestor traversal rounds

## Conclusion

Batching known OIDs into show commands does not avoid repeated Git starts on a deep, narrow ancestry path: each next parent is discovered only after the previous round. A measured slow case had zero failed show commands; missing-object retries were not its cause. Reuse one request-driven cat-file process across rounds while preserving breadth-first ordering, evidence limits and cache behavior.

## Scope

Supplemental commit evidence loading. This does not replace operation-body or Detail reads. Do not fetch unlimited ancestry to avoid iterative reads. Raw object framing uses bytes, not JavaScript string lengths; missing responses must not discard subsequent valid objects.

## Evidence

- Three-run medians reduced evidence loading from 2,617 to 49 ms and backend initial total from 3,309 to 751 ms.
- Commit/Reflog/event data and graph node coordinates/parent edges matched all runs; target repository metadata and status remained unchanged.
- Reader tests cover fragmented UTF-8, missing responses, premature exit and timeout. Real-Git metadata comparison covers unicode, multiline subjects, signatures, merge parents and timezone offsets.

## Verification

Run object-reader unit tests, commit-objects and reflog-pagination integration tests. Compare metadata with Git pretty output before extending raw parsing. Keep process cleanup and cache invalidation covered. Separate initial backend improvements from unmeasured GUI latency.
