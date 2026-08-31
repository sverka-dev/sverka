# Spec 20 — RetryPolicy

**Status:** Active
**Source:** specs/architecture-spec.md §22, §24 (`policy.retry`), §25 (Retry Policy row), §32 (deferred from v0 → M1)
**Package:** `@sverka/runtime` (engine-native sub-module); model extension in `@sverka/workflow` (cdk/model.ts)
**Capability:** `policy.retry` — native engine: `native`; GitHub: `emulated` (follow-up lowering); GitLab: `native` (`retry:` keyword)
**Related:** ADR-011, Spec 10 (engine-native), Spec 21 (RunEvent)

## Overview

Step-level retries with exponential backoff in the native engine. When a
step declares `retry: RetryPolicy`, the engine re-runs the **whole step**
(all ordered operations) up to `max` retries on a matching failure, applying
exponential backoff between attempts. A `step-retry` run event is emitted
before each retry.

`RetryPolicy` already exists in the model (`{ max, when?, exitCodes? }`).
Wave 1 adds an optional `backoff?: BackoffSpec` for exponential backoff
(the mega-plan requirement). Without `backoff`, retries are immediate.

## Goals

- `BackoffSpec` added to `RetryPolicy` in cdk/model.ts (optional).
- `executeStepWithRetry` wrapper in engine-native: re-runs the step up to
  `max` retries, classifying each result against `when` / `exitCodes`.
- `step-retry` RunEvent variant (Spec 21).
- Exponential backoff: `delay = min(baseMs * factor^(attempt-1), maxMs)`.
- `policy.retry` GitHub target manifest updated `unsupported` → `emulated`;
  GitLab already `native`. The native engine implements retry directly (no
  engine capability manifest exists today).
- Retry wraps the **whole step** (re-runs all operations), matching
  GitHub/GitLab job-retry semantics.

## Non-goals

- Retry jitter — follow-up.
- Per-operation retry within a step — out of scope (step-level only).
- GHA retry lowering (composite retry wrapper) — follow-up bead.
- Retry hooks / before-after re-run semantics — out of scope.
- Retry for the legacy `runtime/` scheduler — already exists there; not
  extended (ADR-011).

## Interfaces

Model extension (`@sverka/workflow` cdk/model.ts):
```ts
interface BackoffSpec {
  readonly baseMs: number;
  readonly maxMs?: number;   // cap per delay; default: no cap
  readonly factor?: number;  // default: 2
}

interface RetryPolicy {
  readonly max: number;        // max retries (total attempts = max + 1)
  readonly when?: readonly RetryWhen[];   // default: any failure
  readonly exitCodes?: readonly number[]; // overrides `when` when set
  readonly backoff?: BackoffSpec;         // NEW — default: immediate
}
```

`RetryWhen` is unchanged: `"always" | "script_failure" |
"runner_system_failure" | "timeout" | "unknown_failure"`.

No new public exports beyond `BackoffSpec` (re-exported from
`@sverka/workflow`). The retry loop is internal to engine-native.

## Data models

Result classification (`ShellResult` → `RetryWhen`):

| Condition | RetryWhen |
|---|---|
| `timedOut === true` | `timeout` |
| driver threw (non-shell error) | `runner_system_failure` (thrown `Error`) or `unknown_failure` (thrown non-Error) |
| `exitCode === 0` | (success — no retry) |
| `exitCode !== 0` | `script_failure` |
| any failure | `always` |

Retry decision:
- If `exitCodes` set: retry iff `exitCode` ∈ `exitCodes` (ignores `when`).
- Else if `when` set: retry iff the classified `RetryWhen` ∈ `when` or
  `when` includes `"always"`.
- Else (`when` omitted, `exitCodes` omitted): retry on any failure
  (equivalent to `"always"`).

Backoff delay for attempt `n` (1-indexed retry): `min(baseMs *
factor^(n-1), maxMs ?? Infinity)`. No delay when `backoff` omitted.

## Error handling

- A retry attempt that is **cancelled** (abort signal) stops the loop
  immediately → step outcome `cancelled` (no further retries).
- Exhausted retries → step outcome `failed` with the last attempt's error.
- `max < 0` is a validation error (`INVALID_RETRY_POLICY`) raised at
  validate/analyze time, not at runtime.
- `backoff.baseMs < 0` → validation error.

No new error class: validation surfaces through the existing
`SynthesisError`/`TargetDiagnostic` path; runtime retry exhaustion is a
normal `failed` outcome.

## Test plan

1. Step with `retry: { max: 2 }` and a driver that fails twice then
   succeeds: step ends `succeeded`; two `step-retry` events emitted.
2. Step with `retry: { max: 1 }` and a driver that always fails: step ends
   `failed`; one `step-retry` event emitted; total attempts = 2.
3. `when: ["timeout"]`: a non-timeout failure (`exitCode 1`) is **not**
   retried.
4. `when: ["timeout"]`: a timeout (`timedOut: true`) **is** retried.
5. `exitCodes: [1, 2]`: `exitCode 1` retried, `exitCode 3` not retried
   (overrides `when`).
6. `backoff: { baseMs: 100, factor: 2 }`: delays are 100ms (1st retry),
   200ms (2nd retry); `maxMs: 150` caps the 2nd at 150ms.
7. `backoff` omitted: retries are immediate (no delay).
8. Cancellation during backoff sleep: loop stops, outcome `cancelled`, no
   further retries.
9. `max: 0`: no retries (single attempt); no `step-retry` events.
10. `max: -1` rejected by validation (`INVALID_RETRY_POLICY`).
11. Retry re-runs the **whole step**: a step with two operations where the
    second fails — both operations re-run on retry (verify via driver call
    count).
12. `BackoffSpec` exported from `@sverka/workflow`.
