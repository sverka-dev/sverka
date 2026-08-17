# Feature: Continue-on-error / allow-failure

**ID:** F-12
**Category:** scheduling
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Sometimes a step should not block the pipeline when it fails — non-critical checks, optional validations. GitHub uses `continue-on-error` (boolean). GitLab uses `allow_failure` (boolean or map with exit codes). Sverka needs a portable `continueOnError` flag with optional exit-code filtering.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `continue-on-error` | `allow_failure` | `continueOnError` on Step |
| Semantics | Step failure doesn't fail the job/pipeline | Job failure doesn't fail the pipeline | Step failure doesn't block pipeline |
| Value type | boolean or expression | boolean or `{ exit_codes }` | boolean or `{ exitCodes }` |
| Limitations | no exit-code filtering | exit-code filtering via `exit_codes` | — |
| Provider gap | no exit-code filtering | — | exit-code filtering is GitLab-only |

## GitHub Actions

```yaml
steps:
  - name: Lint
    continue-on-error: true
    run: make lint
  - name: Optional check
    continue-on-error: ${{ matrix.optional }}
    run: make optional-check
```

`continue-on-error` accepts boolean or expression. When true, step failure is treated as success for downstream `if: success()` checks.

## GitLab CI

```yaml
lint:
  allow_failure: true
  script: make lint

optional_check:
  allow_failure:
    exit_codes: [1, 2]
  script: make optional-check
```

`allow_failure: true` marks the job as "warning" on failure. `exit_codes` allows failure only for specific exit codes — other exit codes still fail the pipeline.

## Sverka proposal

### Portable model

Add optional `continueOnError?: boolean | { exitCodes: readonly number[] }` to Step.

### Authoring API

```ts
// SDK
task("lint", { run: ..., continueOnError: true }),
task("optional", { run: ..., continueOnError: { exitCodes: [1, 2] } }),
```

### Lowering

- **GitHub target:** `continueOnError: true` → `continue-on-error: true`. `continueOnError: { exitCodes }` → not supported natively. Emulate: set `continue-on-error: true` and emit a warning that exit-code filtering is not available on GitHub.
- **GitLab target:** `continueOnError: true` → `allow_failure: true`. `continueOnError: { exitCodes }` → `allow_failure: { exit_codes: [...] }`.
- **Native engine:** if `continueOnError` is true, step failure is recorded as a warning, not an error. Exit-code filtering: only mark as non-blocking if exit code matches.

### Capability manifest

```ts
"scheduling.continueOnError": "native",
"scheduling.continueOnError.exitCodes": "native",   // GitLab
"scheduling.continueOnError.exitCodes": "emulated", // GitHub (approximate)
```

### Portability & divergence

Exit-code filtering is GitLab-only. On GitHub, Sverka approximates by setting `continue-on-error: true` (all failures are non-blocking) and emits a warning diagnostic. This is a semantic loss — on GitLab, exit code 3 would still fail the pipeline, but on GitHub it wouldn't.

## Non-goals

- Expression-based `continueOnError` (GitHub supports it, but adds complexity).
- Per-operation `continueOnError` (Step-level only).

## Dependencies

- **Depends on:** none.
- **Blocks:** none.

## Open questions

- Should the GitHub emulation for exit-code filtering wrap the command in a shell script that checks `$?`?
- Should `continueOnError` interact with F-11 (conditions)?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontinue-on-error
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#allow_failure
- Architecture spec: §25, §32 (deferred)
