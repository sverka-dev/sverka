# Feature: Timeout

**ID:** F-13
**Category:** execution
**Milestone:** M0 (already in v0)
**Status:** Implemented
**Parent epic:** sv-4wh9

## Summary

A timeout limits how long a step can run before being killed. Both providers
support per-job timeouts. Sverka models timeout as milliseconds on `Step`,
lowering to minutes for both targets. The native engine enforces it via the
runtime driver.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `timeout-minutes` | `timeout` | `Step.timeout` (ms) |
| Semantics | job killed after N minutes | job killed after duration string | step killed after N ms |
| Value type | integer (minutes) | string (`"1h30m"`, `"45m"`) | number (milliseconds) |
| Limitations | minimum 1 minute | format: `Nh`/`Nm`/`Ns` | ms precision, lowered to minutes |
| Provider gap | — | — | sub-minute precision lost in lowering |

## GitHub Actions

```yaml
jobs:
  build:
    timeout-minutes: 30
    runs-on: ubuntu-latest
    steps: [{ run: echo build }]
```

`timeout-minutes` kills the job after the specified number of minutes. Minimum
is 1 (integer).

## GitLab CI

```yaml
build:
  timeout: 1h30m
  script: [echo build]
```

`timeout` accepts duration strings: `Nh`, `Nm`, `Ns`, or combinations. GitLab
has runner-level maximums that may override.

## Sverka proposal

### Portable model

`Step.timeout?: number` in milliseconds (`packages/constructs/src/constructs.ts:86,95`).
Present on `StepDefinition.timeout` (`packages/core/src/graph.ts:60`). Omitted when
undefined.

### Authoring API

```ts
// SDK — sh builder
sh`echo build`.timeout(30000).build(pipeline, "build"); // 30s

// Construct
new ShellStep(pipeline, "build", { command: "echo build", timeout: 30000 });

// Decorator
@step({ timeout: 30000 })
```

### Lowering

Timeout values are validated before lowering: the value must be a finite
number greater than zero. Values that produce invalid provider
representations (e.g., zero or negative) are rejected with a
`LOWER_FAILED` diagnostic. GitHub-hosted runners enforce a 360-minute
maximum; timeouts exceeding that limit are clamped with a warning
diagnostic.

- **GitHub target:** `Math.ceil(timeout / 60000)` → `timeoutMinutes`
  (`github/src/lower.ts:308-309`). Sub-minute precision is lost (rounded up).
- **GitLab target:** `Math.ceil(timeout / 60000)` → `timeout: "${N}m"`
  (`gitlab/src/lower.ts:467-468`). Only minutes format is emitted.
- **Native engine:** `StepExecutor` passes `timeoutMs` to the driver
  (`engine-native/src/step-executor.ts:116`). `HostDriver` uses `setTimeout` →
  SIGTERM → SIGKILL after 2s grace (`runtime-host/src/host-driver.ts:124-148`,
  `GRACE_PERIOD_MS = 2000`). `DockerDriver` uses `--stop-timeout` flag with
  seconds conversion (`runtime-docker/src/docker-driver.ts:91-93`).

### Capability manifest

**Declared as partial.** `githubCapabilities` and `gitlabCapabilities`
include `"execution.timeout": "native"` (timeout is lowered when present).
The native engine supports it via the runtime driver. The feature is
marked **Implemented** because all three targets handle timeout, but
capability-gated diagnostics for targets that lack timeout support are a
follow-up.

### Portability & divergence

Sverka uses milliseconds (fine-grained); both targets use minutes (coarse).
The ceiling rounding means a 30s timeout becomes 1 minute in compiled output.
This is acceptable — sub-minute timeouts are rare in CI. The native engine
preserves full ms precision.

## Non-goals

- Step-level retry with backoff (F-14, M1).
- Timeout per-operation (timeout is per-step).

## Dependencies

- **Depends on:** F-09 (shell ops) — timeout applies to step execution.
- **Blocks:** none.

## Open questions

- Should the lowering emit seconds-precision for GitLab (`Ns` format) instead
  of always minutes?
- Should a default timeout be enforced to prevent runaway steps?
- **Test gap:** `engine-native/src/step-executor.ts:116` passes `timeoutMs`
  to the driver, but no test in `engine-native/__tests__/` verifies the
  passthrough. Timeout enforcement is tested only in the driver packages
  (`runtime-host`, `runtime-docker`).

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#timeout
- Architecture spec: §15
- Source: `packages/constructs/src/constructs.ts:86,95`, `packages/core/src/graph.ts:60`, `packages/sdk/src/sh.ts:55-57`, `packages/decorators/src/types.ts:7`, `packages/github/src/lower.ts:308-309`, `packages/gitlab/src/lower.ts:467-468`, `packages/engine-native/src/step-executor.ts:116`, `packages/runtime-host/src/host-driver.ts:124-148`, `packages/runtime-docker/src/docker-driver.ts:91-93`
