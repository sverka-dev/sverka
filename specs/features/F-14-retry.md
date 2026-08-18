# Feature: Retry

**ID:** F-14
**Category:** execution
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Retries automatically re-run a failed step. GitLab has native `retry` with max count, failure-type filtering, and exit-code filtering. GitHub has no native retry — users resort to actions or shell loops. Sverka should support portable retry with failure-type and exit-code filtering.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | (none — actions/loops) | `retry` | `retry` on Step |
| Semantics | n/a | Re-run job on failure up to N times | Re-run step on failure up to N times |
| Value type | n/a | number (0-2) or `{ max, when, exit_codes }` | `{ max, when?, exitCodes? }` |
| Limitations | no native support | max 2 retries | — |
| Provider gap | no native retry | — | GitHub: emulated via shell wrapper |

## GitHub Actions

No native retry. Workarounds:
```yaml
steps:
  - name: Retry build
    uses: nick-fields/retry@v3
    with:
      max_attempts: 3
      command: make build
```

Or shell loop:
```yaml
steps:
  - run: |
      for i in 1 2 3; do
        make build && break || sleep 10
      done
```

## GitLab CI

```yaml
build:
  retry:
    max: 2
    when:
      - script_failure
      - runner_system_failure
    exit_codes: [1, 2]
  script: make build
```

`when` values: `always`, `unknown_failure`, `script_failure`, `api_failure`, `runner_system_failure`, `stuck_or_timeout_failure`, `runner_unsupported`. `max` is 0, 1, or 2.

## Sverka proposal

### Portable model

Add optional `retry?: RetryPolicy` to Step:

```ts
interface RetryPolicy {
  readonly max: number;           // 0-2 (GitLab limit)
  readonly when?: readonly RetryWhen[];
  readonly exitCodes?: readonly number[];
}

type RetryWhen =
  | "always"
  | "script_failure"
  | "runner_system_failure"
  | "timeout"
  | "unknown_failure";
```

### Authoring API

```ts
// SDK
task("build", {
  run: ...,
  retry: { max: 2, when: ["script_failure", "runner_system_failure"] },
}),
```

### Lowering

- **GitHub target:** no native retry. Emulate: wrap `run` command in a shell retry loop. `exitCodes` → check `$?` in loop. `when` filtering not possible (GitHub doesn't expose failure types) — approximate: retry on any non-zero exit.
- **GitLab target:** `retry` → `retry:` with `max`, `when`, `exit_codes`. Direct mapping.
- **Native engine:** re-run the step's operations up to `max` times. Check exit code against `exitCodes` if specified. Apply `when` filtering based on failure type.

### Capability manifest

```ts
"execution.retry": "native",       // GitLab
"execution.retry": "emulated",     // GitHub (shell wrapper)
```

### Portability & divergence

GitLab has native retry with rich failure-type filtering. GitHub has no native support — Sverka emulates with a shell wrapper that retries on non-zero exit. Failure-type filtering (`when`) is lost on GitHub because the shell wrapper can't distinguish failure types. This is documented as a known divergence.

## Non-goals

- Retry backoff strategies (exponential, linear).
- Retry delay between attempts.
- Per-operation retry (Step-level only).

## Dependencies

- **Depends on:** F-09 (shell operations).
- **Blocks:** none.

## Open questions

- Should the GitHub shell wrapper include a sleep between retries?
- Should `max` be capped at 2 (GitLab limit) or allow higher for native engine?
- Should `RetryWhen` be a typed union or free-form strings?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#retry
- Architecture spec: §25, §32 (deferred)
