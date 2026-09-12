---
id: rm-20260913-bounded-long-parent-routing
topic: graph-routing
type: decision
status: active
maturity: candidate
created: 2026-09-13
last_verified: 2026-09-13
source_commit: "693d82c53ef79bf2956309dcb3866cd13f13d140"
related_files:
  - src/layout/edgeRouter.ts
  - tests/unit/long-parent-routing.test.ts
  - docs/technical/graph-architecture.md
tags:
  - parent
  - long-edge
  - node-avoidance
---

# Conditionally adopt bounded vertical corridors for long parent edges

## Conclusion

A single cubic avoiding many intervening commits can bow across a whole long span. For ordinary parent paths with different endpoint X and at least eight final row heights of separation, try source/target corridors and their half-lane offsets. Short endpoint curves join a straight middle section. Adopt only candidates whose complete curves clear unrelated node/ring geometry; retain existing routing otherwise. This is a limited adoption, not a guarantee of a new route for every topology.

## Scope

Current and historical ordinary parent edges. Same-X paths, short edges, Rebase event-split parent paths and Operation Overlays retain existing routing. Do not move nodes or discard edges to make a candidate fit. Consumers of SVG path data must support multiple cubic segments.

## Evidence

- Existing Octopus/current/historical/Amend tests pass; a stretched current/old four-parent topology preserves all twelve parent edges.
- Twenty generated multi-parent DAGs with irregular row gaps and three densities validate endpoints, monotone Y and sampled clearance for all returned paths. An intentionally blocked corridor case verifies fallback.
- Read-only real-repository comparison changed exactly one long historical edge, preserving node coordinates, tracks, parent edges and overlay paths. Browser-rendered before/after SVGs show the full-span bow replaced by a vertical route with a short final join.
- Warm Compact layout median across ten measured iterations was approximately 4.45 ms before and 0.89 ms after for that repository. This is not an end-to-end UI guarantee.
- Target Git metadata and worktree status remained unchanged.

## Verification

Run long-parent-routing, dag-node-avoidance, layout and pagination tests plus the full suite. Inspect any topology where candidates fail rather than widening the search indefinitely. Native VS Code visual verification remains separate from SVG/browser checks.
