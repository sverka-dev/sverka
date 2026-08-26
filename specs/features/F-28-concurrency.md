# Feature: Concurrency & resource groups

**ID:** F-28
**Category:** concurrency
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Concurrency control prevents multiple pipeline runs from executing simultaneously — useful for deployments where parallel runs would conflict. GitHub uses `concurrency` with group, cancel-in-progress, and queue. GitLab uses `resource_group` for mutual exclusion. Sverka needs a portable concurrency model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `concurrency` | `resource_group` | `concurrency` on Step/Pipeline |
| Semantics | Only one job per group runs at a time | Only one job per resource group across pipelines | Mutual exclusion per group |
| Value type | map with `group`, `cancel-in-progress`, `queue` | string | `{ group, cancelInProgress? }` |
| Limitations | — | no cancel-in-progress | — |
| Provider gap | — | no cancel, no queue | cancel/queue is GitHub-only |

## GitHub Actions

```yaml
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true
```

Workflow-level or job-level. `group` identifies the concurrency group. `cancel-in-progress` cancels running jobs when a new one starts. `queue`: `single` (one pending) or `max` (all pending).

## GitLab CI

```yaml
deploy:
  resource_group: production
  script: deploy
```

`resource_group` ensures only one job with the same group name runs at a time across all pipelines. No cancel-in-progress — pending jobs wait in queue.

## Sverka proposal

### Portable model

```ts
interface ConcurrencySpec {
  readonly group: string;
  readonly cancelInProgress?: boolean;  // default: false
}
```

Pipeline-level or Step-level.

### Authoring API

```ts
// SDK — pipeline-level
defineWorkflow({
  name: "Deploy",
  concurrency: { group: expr`deploy-${git.branch}`, cancelInProgress: true },
  workflow: pipeline(...),
}),

// SDK — step-level
task("deploy", {
  run: ...,
  concurrency: { group: "production" },
}),
```

### Lowering

- **GitHub target:** `concurrency` → `concurrency:` map. `group` → `group`. `cancelInProgress` → `cancel-in-progress`.
- **GitLab target:** `concurrency` → `resource_group:` string (group name only). `cancelInProgress` → not supported (emit warning).
- **Native engine:** use a mutex/lock per group name. `cancelInProgress` → cancel running step when a new one requests the lock.

### Capability manifest

```ts
// githubCapabilities:
"concurrency.group": "native",
"concurrency.cancelInProgress": "native",
// gitlabCapabilities:
"concurrency.group": "native",
"concurrency.cancelInProgress": "unsupported",
```

### Portability & divergence

GitHub has richer concurrency control (cancel, queue). GitLab only has mutual exclusion. Sverka's portable model covers group + cancelInProgress. `cancelInProgress` is dropped on GitLab with a warning. `queue` mode is GitHub-only and not in the portable model.

## Non-goals

- `queue` mode is a GitHub-specific provider extension, not part of
  `ConcurrencySpec`. It accepts `single` (one pending run) or `max` (all
  pending runs), rejects more than 100 pending runs, and disallows `max`
  with `cancel-in-progress: true`. Lowering emits GitHub Actions
  `concurrency.queue` configuration. GitLab and native targets do not
  support it.
- Cross-repository concurrency groups.
- Dynamic group name evaluation on GitLab (static only).

## Dependencies

- **Depends on:** F-35 (expressions) for dynamic group names.
- **Blocks:** F-29 (interruptible uses concurrency concepts).

## Decisions (open questions resolved)

- **`concurrency` is both Pipeline-level and Step-level.** Pipeline-level
  applies to the entire workflow (GitHub `concurrency` at workflow level,
  GitLab `resource_group` on all jobs). Step-level applies to individual
  jobs (GitHub `concurrency` at job level, GitLab `resource_group` on
  that job).
- **Native engine concurrency is deferred.** The native engine mutex/lock
  is a runtime concern (F-18 / native engine). This feature only adds the
  portable concurrency model and target lowering.
- **`queue` mode is not in the portable model.** It is GitHub-only and
  excluded. If needed, it can be a GitHub provider extension in the future.

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#concurrency
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#resource_group
- Architecture spec: §25, §32 (deferred)
