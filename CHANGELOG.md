# Changelog

## 1.0.0

- Add a dedicated sidebar view with narrower lanes, node-aligned messages, and click-to-open detail popovers.
- Default editor and bottom-panel views to Compact density and refresh the density selector design.
- Speed up history loading with validated caches, parallel Reflog reads, and a reused Git object reader.
- Improve long-distance parent routing, pagination boundaries, metadata alignment, and toolbar sizing while preserving Git parent relationships.

## 0.1.0

Initial release of Git Lines.

- Read-only Git DAG with stable branch lanes, Working Tree state, and commit details.
- Reflog history and evidence-based overlays for supported Git operations, including amend, cherry-pick, revert, reset, branch movement, and rebase.
- In-progress operation information, detached HEAD, linked worktrees, and complex merge topologies.
- Open the graph in an editor tab or the bottom panel from the Git Lines status bar item or Command Palette.
- Reflog visibility, display density, incremental history loading, and refresh controls.
