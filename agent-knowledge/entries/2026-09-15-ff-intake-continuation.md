---
id: rm-20260915-ff-intake-continuation
topic: graph-routing
type: decision
status: active
maturity: candidate
created: 2026-09-15
last_verified: 2026-09-15
source_commit: "b6341f1"
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

A preserved feature column alone does not meet the intended FF display. With explicit intake evidence, the receiving branch must continue through an existing FF event and visibly receive the source route. Commit parents and current refs remain factual. BranchIntegration paths express this separate requirement; do not classify a missing receiver flow as correct merely because the Git DAG is linear.

## Scope

Explicit local merge FF with matching old/new reflog, loaded linear range and unique source creation evidence. The current implementation is limited to a receiving-route base and distinct source tip. Reflog OFF, ambiguous/missing evidence, same-tip coincidence, pull synchronization and unnamed ref moves do not activate it. Declining an intake does not revoke existing branch independence. In particular 113's unnamed update-ref is not FF evidence.

## Evidence

On the b6341f1 baseline, 21/22/23/141/142/143 had sufficient evidence but no receiver continuation. The limited change affects only their twelve Reflog-ON/mode combinations in a 400-condition comparison. Real edges, commit data and tracks remain identical. 469 tests pass; both modes have before/after GUI captures. Deleted feature refs are not recreated.

## Verification

Run pnpm check and compare the saved real fixture inputs. Inspect the receiver base → FF junction → later receiver/Working Tree, as well as source tip → junction. A same-tip label or an FF caption alone is insufficient source-identity evidence. Review scope limitations in the design report before generalizing to nonlinear or mixed-origin imports.
