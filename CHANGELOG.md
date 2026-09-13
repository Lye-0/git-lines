# Changelog

## 1.0.3

- Add Japanese and English README language links, with Japanese as the GitHub default.
- Use a dedicated English README for Marketplace, linking to both GitHub language versions.
- Show the Star on GitHub button only in the Marketplace README.

## 1.0.2

- Fix vertical graph alignment in Compact mode across editor, bottom-panel, and sidebar views.
- Keep nodes, connecting edges, and operation markers aligned while preserving Comfortable mode positioning.

## 1.0.1

- Improve automatic graph refresh after commits, branch changes, staging, and Git operation state changes, including linked worktrees.
- Refresh Working Tree changes using the built-in VS Code Git extension's state notifications.
- Coalesce rapid change notifications and prevent read-only status checks from triggering redundant refreshes.

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
