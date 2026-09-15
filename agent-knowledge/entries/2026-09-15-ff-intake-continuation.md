---
id: rm-20260915-ff-intake-continuation
topic: graph-routing
type: decision
status: active
maturity: candidate
created: 2026-09-15
last_verified: 2026-09-15
source_commit: "7f0a1fb"
related_files:
  - src/model/branchIntegration.ts
  - src/layout/branchIntegrationLayout.ts
  - tests/integration/branch-integration.test.ts
  - docs/design/ff-branch-integration-verification.md
tags:
  - fast-forward
  - branch-continuation
  - evidence
---

# Proven FF intake needs receiver continuity as well as source independence

## Conclusion

A preserved feature column alone does not meet the intended FF display. With explicit intake evidence, the receiving branch must continue through an evidence-backed junction and visibly receive the source route. Commit parents and current refs remain factual. BranchIntegration paths express this separate requirement; do not classify a missing receiver flow as correct merely because the Git DAG is linear.

## Scope

Explicit local merge FF with matching old/new reflog, loaded linear range and unique source creation evidence. The current implementation is limited to a receiving-route base and distinct source tip. Ambiguous/missing evidence, same-tip coincidence, pull synchronization and unnamed ref moves do not activate it. Reflog OFF retains proven branch paths but hides operation marks, rows, hit areas, details, historical-only commits and ghost refs. It reuses existing branch-protection evidence on cold loads; after compacting visible rows, routing uses a local unrendered junction half a row above the source tip. Missing visible endpoints decline routing. Declining an intake does not revoke existing branch independence. In particular 113's unnamed update-ref is not FF evidence.

## Evidence

On the b6341f1 baseline, 21/22/23/141/142/143 had sufficient evidence but no receiver continuation. The limited change affects only their twelve Reflog-ON/mode combinations in a 400-condition comparison. Real edges, commit data and tracks remain identical. The subsequent OFF change on 7f0a1fb changes only the corresponding twelve OFF combinations; 472 tests pass, with 24 current GUI captures across both flags/modes. Deleted feature refs are not recreated.

## Verification

Run pnpm check and compare the saved real fixture inputs. Include cold OFF, ON↔OFF, fresh reads after evidence expiration in disposable repos, and hidden-event selection. Inspect the receiver base → intake junction → later receiver/Working Tree, as well as source tip → junction. A same-tip label or an FF caption alone is insufficient source-identity evidence. Review scope limitations in the design report before generalizing to nonlinear or mixed-origin imports.
