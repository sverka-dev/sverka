# Feature: Delayed execution

**ID:** F-48
**Category:** scheduling
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Delayed execution starts a job after a specified wait time. GitLab supports this via `when: delayed` with `start_in`. GitHub has no native equivalent — users resort to sleep steps or external schedulers. Sverka needs a portable delay model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | (none — sleep step) | `when: delayed` + `start_in` | `delay` on Step |
| Semantics | n/a | Job starts after specified duration | Step starts after delay |
| Value type | n/a | `start_in` duration string | `delay: string` (duration) |
| Limitations | no native support | max 1 hour | — |
| Provider gap | no equivalent | — | GitHub: emulated via sleep |

## GitLab CI

```yaml
delayed_job:
  when: delayed
  start_in: 5 minutes
  script: echo "Running after delay"
```

`start_in` accepts duration strings: `5 seconds`, `30 minutes`, `1 hour`, etc. Maximum is 1 hour. The job is created in a "delayed" state and auto-starts after the timer.

## GitHub Actions

No native equivalent. Workarounds:

```yaml
steps:
  - name: Wait
    run: sleep 300
  - name: Run job
    run: echo "Running after delay"
```

This blocks the runner for the entire sleep duration — not efficient.

## Sverka proposal

### Portable model

Add optional `delay?: string` (duration string) to Step. When specified, the step waits for the given duration before starting.

### Authoring API

```ts
task("delayed-deploy", {
  run: sh`deploy`,
  delay: "5m",
}),
```

### Lowering

- **GitHub target:** `delay` → not natively supported. Emulate: insert a `sleep` step before the main step. Convert duration to seconds. Emit warning: "Delayed execution is emulated on GitHub via sleep. The runner will be occupied during the delay."
- **GitLab target:** `delay` → `when: delayed` + `start_in: <duration>`. Direct mapping.
- **Native engine:** wait for the specified duration before starting the step. Use `setTimeout` or similar.

### Capability manifest

```ts
"scheduling.delay": "native",      // GitLab
"scheduling.delay": "emulated",    // GitHub (sleep step)
```

### Portability & divergence

GitLab has native delayed execution (job is queued, runner is free during delay). GitHub has no equivalent — Sverka emulates with a sleep step, which occupies the runner. This is a significant efficiency difference documented via diagnostic.

## Non-goals

- Cron-based scheduling (covered by F-05).
- Retry delays (covered by F-14).
- Complex delay patterns (random, exponential).

## Dependencies

- **Depends on:** F-11 (conditions — `when: delayed` is a condition variant).
- **Blocks:** none.

## Open questions

- Should the GitHub emulation use a sleep step or a no-op action with timeout?
- Should the native engine implement real delayed scheduling?
- Should `delay` support expression-based dynamic durations?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#when
- GitLab: https://docs.gitlab.com/ee/ci/jobs/job_control.html#run-a-job-after-a-delay
- Architecture spec: §25, §32 (deferred)
