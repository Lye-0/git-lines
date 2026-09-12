# History loading: measurement and cache contract

The Git Lines output channel emits `perf` records per graph request. Git records contain the command name, elapsed milliseconds, stdout byte count and success flag, not arguments or commit contents. Stage records cover discovery, state reads, commit reads, Reflog, evidence and event resolution. Graph records separate fact construction, layout, Git process count and `postMessage` delivery.

`presentedMs` measures host request start to a Webview acknowledgement after two animation frames. `webviewMs` measures receipt to that acknowledgement. These approximate a rendering opportunity; they are not GPU presentation timestamps. Hidden views can throttle frames. Overwritten graphs may have no acknowledgement; retained request timestamps are bounded. Concurrent Git command durations overlap and must not be summed as wall-clock latency.

## Reuse and invalidation

- Density changes reuse the snapshot and preserve Detail. They rebuild presentation without Git reads. Reflog changes still read the required data.
- Each session owns its GitClient caches. No persistent disk cache is introduced.
- Page reuse requires identical repository metadata, refs, worktree HEADs and shallow boundaries. A prospective next page uses previous immutable tip OIDs and `--skip`; validation runs alongside it. If identity changes, discard that page and read from the current tip. Normal refs/status/operation checks remain fresh.
- The cached prefix is limited to 2,000 commits and 64 unique tips, bounding Windows command-line size. Larger repositories still work using full-prefix reads.
- Supplemental commit objects are copied into a root/OID cache capped at 2,000 entries. A changed page identity clears it. Missing objects are not cached as successes. Commit bodies required for operation evidence remain freshly fetched.
- Uncached supplementary commits use one lazy `git cat-file --batch` process per evidence traversal, closed in `finally`. The existing breadth-first ordering, 500-object cap and maximum 64 outstanding requests remain intact. Responses are framed by byte lengths, with per-request timeouts and bounded shutdown. Missing OIDs are individual responses, not failures of the whole batch. Raw commit metadata honors parent order, author/committer timestamps and declared encoding; unsupported decoder encodings fall back to Git pretty output.
- Reflog reuse requires matching file identity, size, modification time and change time. HEAD uses the worktree Git directory; other refs use the common directory. Missing files, unsupported storage and stat failures fall back to Git. Retention is capped at 256 files and 20,000 entries in total; this bounds reuse, not displayed history.
- Uncached Reflogs are fetched by at most four workers. Results are stored by the original ref index and flattened in that order, preserving the sequential classifier input even when processes complete out of order. An unavailable log contributes no entries without cancelling other workers. There is no new history count limit.
- Manual refresh clears all caches, including when requested during a read. Watcher events during reads coalesce into a subsequent full state check; a pending data update takes precedence over a presentation-only update. Dispose prevents subsequent queued work and logging.

## Phase 1–2 measurement on 2026-09-12

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

## Phase 3: bounded Reflog parallelism

Same read-only repository, Reflog ON, three interleaved runs per variant with no concurrent build/test load. Baseline is `f73b612` (phase 1–2). Values are medians. Initial means a new client cache; total still excludes GUI delivery/rendering.

| Concurrency | Initial Reflog stage | Initial total | Append total | Unchanged total |
|---|---:|---:|---:|---:|
| 1 (baseline) | 1,729 ms | 4,582 ms | 659 ms | 351 ms |
| 2 | 865 ms | 3,847 ms | 689 ms | 351 ms |
| 4 (adopted) | 406 ms | 3,403 ms | 672 ms | 354 ms |

Four workers reduced the Reflog stage by approximately 77% and initial total by 26%. Git command counts remained 103/23/17 for initial/append/unchanged. Cache-heavy phases remain approximately unchanged. Snapshot commit/Reflog/event data and node row/lane/parent-edge digests matched across all variants and runs; target Git metadata and worktree status were unchanged.

The regression test also forces out-of-order completion and a missing Reflog, verifies equality with sequential parsing, and asserts that concurrent Reflog commands never exceed four. The existing cache invalidation tests remain applicable. Supplementary object loading still contributes to initial latency; progressive statistics and rendering virtualization remain outside this phase. GUI measurement is still unperformed.

## Supplementary object process reuse

Baseline `ff5e784`, same repository and three interleaved runs per implementation. Investigation found no failed `show` commands in this case: repeated process starts while traversing successive ancestors caused the delay, rather than missing-OID retries.

| Phase | Total before → after | Evidence before → after | Git processes before → after |
|---|---:|---:|---:|
| Initial 30, Reflog ON | 3,309 → 751 ms | 2,617 → 49 ms | 103 → 54 |
| Append to 40 | 555 → 491 ms | 215 → 40 ms | 23 → 19 |
| Unchanged 40 | 432 → 326 ms | 2 → 1 ms | 17 → 17 |

These medians exclude GUI delivery/rendering. The initial total improved approximately 77%; warm-read differences also include normal Git process timing variation. Commit/Reflog/event data and node row/lane/parent-edge digests matched in every comparison. Target Git metadata and worktree status remained unchanged. UTF-8 multibyte framing, binary separators, missing objects, trees, merge parent order, multiline subjects, timezones, abnormal exit and request timeout have regression coverage. GUI measurement remains unperformed.
