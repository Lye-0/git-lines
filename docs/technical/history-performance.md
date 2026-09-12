# History loading: measurement and cache contract

The Git Lines output channel emits `perf` records per graph request. Git records contain the command name, elapsed milliseconds, stdout byte count and success flag, not arguments or commit contents. Stage records cover discovery, state reads, commit reads, Reflog, evidence and event resolution. Graph records separate fact construction, layout, Git process count and `postMessage` delivery.

`presentedMs` measures host request start to a Webview acknowledgement after two animation frames. `webviewMs` measures receipt to that acknowledgement. These approximate a rendering opportunity; they are not GPU presentation timestamps. Hidden views can throttle frames. Overwritten graphs may have no acknowledgement; retained request timestamps are bounded. Concurrent Git command durations overlap and must not be summed as wall-clock latency.

## Reuse and invalidation

- Density changes reuse the snapshot and preserve Detail. They rebuild presentation without Git reads. Reflog changes still read the required data.
- Each session owns its GitClient caches. No persistent disk cache is introduced.
- Page reuse requires identical repository metadata, refs, worktree HEADs and shallow boundaries. A prospective next page uses previous immutable tip OIDs and `--skip`; validation runs alongside it. If identity changes, discard that page and read from the current tip. Normal refs/status/operation checks remain fresh.
- The cached prefix is limited to 2,000 commits and 64 unique tips, bounding Windows command-line size. Larger repositories still work using full-prefix reads.
- Supplemental commit objects are copied into a root/OID cache capped at 2,000 entries. A changed page identity clears it. Missing objects are not cached as successes. Commit bodies required for operation evidence remain freshly fetched.
- Reflog reuse requires matching file identity, size, modification time and change time. HEAD uses the worktree Git directory; other refs use the common directory. Missing files, unsupported storage and stat failures fall back to Git. Retention is capped at 256 files and 20,000 entries in total; this bounds reuse, not displayed history.
- Manual refresh clears all caches, including when requested during a read. Watcher events during reads coalesce into a subsequent full state check; a pending data update takes precedence over a presentation-only update. Dispose prevents subsequent queued work and logging.

## Measurement on 2026-09-12

Three sequential runs per version against the same read-only local repository, comparing commit `e6174aa` with this change. Medians below include snapshot, graph facts and layout, but exclude VS Code startup, Webview delivery and rendering. Initial means a new client cache, not a cold OS filesystem cache. Repeated reads use the same client. A manual forced refresh intentionally bypasses reuse.

| Reflog | Action | Before | After | Git commands before → after |
|---|---|---:|---:|---:|
| ON | Initial 30 | 4,641 ms | 4,812 ms | 103 → 103 |
| ON | Append to 40 | 4,851 ms | 638 ms | 107 → 23 |
| ON | Unchanged 40 | 4,820 ms | 335 ms | 107 → 17 |
| OFF | Initial 30 | 313 ms | 401 ms | 17 → 17 |
| OFF | Append to 40 | 297 ms | 307 ms | 17 → 17 |
| OFF | Unchanged 40 | 292 ms | 294 ms | 17 → 16 |

Initial loading is not materially improved by this cache work; Windows Git process timings vary between runs. Reflog ON facts/layout were only a few milliseconds; Reflog and supplementary object commands dominate the remaining initial delay. Do not present warm-cache gains as first-open or end-to-end GUI gains. Reflog parallelization, progressive statistics and rendering virtualization are outside this change.

Target worktree status and Git metadata fingerprints were unchanged. Regression coverage includes appended/fresh equality, multiple branches and annotated tags, detached HEAD, moved refs, Reflog expiry, force refresh, Density without Git, and queued watcher changes. GUI measurement has not been performed for this change.
