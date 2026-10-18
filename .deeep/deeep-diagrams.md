# deeep workflow and recovery

Implementation: `~/.pi/agent/extensions/deeep.ts` plus `deeep/runtime.ts` and `deeep/worker-runner.mjs` beside it. These diagrams describe the current code.

- [Workflow](deeep-flow.svg) ([D2 source](deeep-flow.d2)): planning, approval, checkpoint recovery, task scheduling and the review/merge prompt. Connector **A** repeats the scheduler tick.
- [One task](deeep-task.svg) ([D2 source](deeep-task.d2)): preparation, implementation, commit and publication, with durable checkpoints and non-destructive failure paths.

## Merge review — prompt, not polling

1. Save the exact outstanding task ids in `state.json` before opening the prompt.
2. List their branches and PR URLs. Ask the user to review and merge into `main`.
3. **Yes:** fetch `origin/main` and script-check actual merges. Yes itself is not evidence.
4. If any remain unmerged/unverified, show the prompt again with only those branches. Verification errors also leave the gate closed.
5. When none remain, clear the saved gate and continue at scheduler tick **A**.
6. **No / Esc / missing UI / stop:** pause without forgetting the gate. `/deeep go` restores it, first accounting for merges made while disconnected.

There is no timer polling PR merge status. Cancellation/supervisor watchers monitor stop requests and worker completion only.

Merge proof is either the recorded task commit being an ancestor of fetched `origin/main`, or GitHub reporting the task PR as `MERGED` into `main` with the matching head commit. This supports squash merges without trusting an unrelated or older PR. Local-only merges do not count until pushed.

## Ownership and scheduling

- **Human (amber):** request, plan approval, PR review/merge and affirmative verification requests.
- **Main model (green):** clarification and task planning only.
- **Scripts (blue):** readiness, process starting, branches/worktrees, commits, push/PR publication, merge checks and recovery.
- **Worker model (green in the task diagram):** one implementation plus its checks; no git handling. This is a prompt rule, not a security sandbox.

A pending task is eligible only after all dependencies are done and script-verified merged. Independent ready tasks may run while unrelated PRs are unmerged. Batches are bounded by `DEEEEP_MAX_PARALLEL` (default 2), and the scheduler awaits the batch before recalculating eligibility. New worktrees start strictly from successfully fetched `origin/main`; retries reuse their existing work, rather than force-resetting it. Old dependency branches are not re-merged after squash merging: fetched main already contains the dependency implementation.

## Stop / disconnect / resume

`/deeep go` always enters recovery, including when no implementation tasks remain and only publication or merges are pending. No manual status reset is needed for failed/interrupted attempts.

| Saved situation | Recovery action |
|---|---|
| Worker still alive after parent disconnect | Adopt its supervised process and await the same result; do not start another implementation |
| Worker completed while disconnected | Consume its durable receipt; continue to commit |
| Worker interrupted or failed | Keep partial files; retry implementation in the same worktree |
| Commit completed before state checkpoint | Recognize the task trailer and reuse that commit |
| Commit failed | Resume commit, not a previously successful implementation |
| Push/PR publication incomplete | Retry push; find existing PR before creating one; do not re-run implementation |
| Review dialog interrupted | Restore the saved outstanding branch list and recheck real merge state |
| Another session already owns the repo | Refuse duplicate dispatch; `/deeep stop` can signal that runner across sessions |
| Network unavailable | Pause with the last checkpoint; no local-main fallback or false success |

State is atomically replaced after each transition. An OS `flock` lease permits one controller per repository, releases on parent death, and avoids stale PID-file locks. Separate per-worker leases prevent duplicate orphan workers. Shared Git/gh operations are serialized with an additional OS operations lock, including commands that briefly outlive a disconnected controller; file edits are isolated by task worktrees. Stop signals terminate worker process groups, not just the immediate pi child. Reload/shutdown requests a cooperative stop and retains checkpoints.

## Files

- `.deeep/state.json`: task status/stage, worktree, base/implementation/commit SHAs, worker token, PR URL and saved merge gate.
- `.deeep/<task>.worker.json`: durable worker identity and completion receipt.
- `.deeep/<task>.worker-config.json`: supervisor launch configuration.
- `.deeep/<task>.txt` and `.jsonl`: readable and raw worker logs.
- `.deeep/<task>.pr.md`: script-generated PR body.
- `.deeep/worktrees/<task>`: retained on stop/failure; removed without force only after confirmed publication.
- `.deeep/run.lock`, `.deeep/ops.lock`, worker locks and `STOP`: coordination files; never delete a live lock file.

Only confirmed publication marks a task done. Failed workers (including model errors with process exit zero) do not get their partial code committed. Worker test claims are still self-reported; this does not add an independent test runner. Merge conflicts or external branch edits fail safely with a concrete error rather than discarding user work.

## Validate and render

```sh
node --experimental-strip-types --test ~/.pi/agent/extensions/deeep/runtime.test.ts
d2 validate .deeep/deeep-flow.d2
d2 --layout dagre --pad 30 .deeep/deeep-flow.d2 .deeep/deeep-flow.svg
d2 validate .deeep/deeep-task.d2
d2 --layout elk --pad 30 .deeep/deeep-task.d2 .deeep/deeep-task.svg
```
