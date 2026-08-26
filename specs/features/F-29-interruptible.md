# Feature: Interruptible & auto-cancel

**ID:** F-29
**Category:** concurrency
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Interruptible jobs can be cancelled mid-run when a new pipeline starts, saving resources. GitLab has `interruptible` (per-job boolean) and `workflow:auto_cancel` (workflow-level policy). GitHub's `concurrency.cancel-in-progress` achieves a similar effect. Sverka needs a portable interruptible model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `concurrency.cancel-in-progress` | `interruptible`, `workflow:auto_cancel` | `interruptible` on Step |
| Semantics | Cancel running jobs in concurrency group on new run | Cancel job if new commit pushed and job is interruptible | Step can be cancelled on new run |
| Value type | boolean | boolean (per-job) + enum (workflow) | boolean |
| Limitations | tied to concurrency group | requires `workflow:auto_cancel: on_new_commit: interruptible` | — |
| Provider gap | — | — | different mechanisms, same intent |

## GitHub Actions

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

When a new workflow run starts in the same group, running jobs are cancelled. This is group-level, not per-job.

## GitLab CI

```yaml
workflow:
  auto_cancel:
    on_new_commit: interruptible

build:
  interruptible: true
  script: make build

deploy:
  script: make deploy
  # not interruptible — won't be cancelled
```

`interruptible: true` marks a job as cancellable. `workflow:auto_cancel:on_new_commit: interruptible` enables auto-cancellation. Only jobs with `interruptible: true` are cancelled when a new commit is pushed. `on_new_commit` values: `conservative` (no cancellation), `interruptible` (cancel interruptible jobs), `none`.

## Sverka proposal

### Portable model

Add optional `interruptible?: boolean` to Step. When true, the step can be cancelled if a new pipeline run starts.

### Authoring API

```ts
task("build", { run: ..., interruptible: true }),
task("deploy", { run: ..., interruptible: false }),
```

### Lowering

- **GitHub target:** `interruptible` → not directly supported per-job. Approximate: if all steps in a pipeline are interruptible, set `concurrency.cancel-in-progress: true` at workflow level. If mixed, emit warning that per-job interruptible is not supported.
- **GitLab target:** `interruptible` → `interruptible:` boolean per job. Also emit `workflow:auto_cancel: on_new_commit: interruptible` at pipeline level if any step is interruptible.
- **Native engine:** if a new run is requested and a step is `interruptible: true`, cancel the running step.

### Capability manifest

```ts
"concurrency.interruptible": {
  gitlab: "native",       // per-job interruptible: boolean
  github: "partial",      // workflow-level cancel-in-progress only
},
```

### Portability & divergence

GitLab has fine-grained per-job interruptible control. GitHub only has workflow-level cancel-in-progress tied to concurrency groups. Sverka's portable model supports per-step `interruptible`, which maps cleanly to GitLab but is approximated on GitHub.

## Non-goals

- `workflow:auto_cancel:on_job_failure` (GitLab-specific).
- `conservative` vs `interruptible` auto-cancel modes (GitLab-specific).

## Dependencies

- **Depends on:** F-28 (concurrency — related concept).
- **Blocks:** none.

## Decisions (open questions resolved)

- **GitHub approximation:** emit a `warning`-severity diagnostic via the
  capability manifest (`concurrency.interruptible: "partial"` on GitHub).
  Do NOT emit a `concurrency:` block — that is F-28's surface. Per-job
  `interruptible` is silently dropped on GitHub; the diagnostic informs the
  user. Rationale: GitHub has no per-job interruptible construct; emitting a
  workflow-level `concurrency.cancel-in-progress` would change semantics for
  the whole workflow and collide with F-28's explicit `concurrency` lowering.
- **`interruptible` is Step-level only.** GitLab's `interruptible` is per-job;
  GitHub's `cancel-in-progress` is workflow/concurrency-group level (F-28).
  A Pipeline-level boolean would be redundant with F-28's
  `cancelInProgress`. Keep the portable model aligned with the finer-grained
  provider (GitLab) and let the GitHub diagnostic explain the downgrade.
- **Native engine:** no new cancellation signals. The engine already has
  `Engine.cancel(runId)` and `AbortController`-based step cancellation
  (engine.ts:93, :400). `interruptible` is a *declaration* of cancellability,
  not a new mechanism. A future "auto-cancel on new run" orchestrator can
  consult `step.interruptible` before calling `cancel()`. This wave only
  threads the field through the graph and lowering; engine behaviour change
  is out of scope (no scheduler change needed for the declaration to be
  useful to callers and to lower correctly).

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#interruptible
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#workflowauto_cancel
- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#concurrencycancel-in-progress
- Architecture spec: §25, §32 (deferred)
