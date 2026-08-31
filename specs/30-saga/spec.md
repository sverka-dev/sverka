# Spec 30 — Saga Compensations

**Status:** Active
**Source:** v1 mega-plan (sv-wthn.3); architecture spec §22 (Native Engine), §22.3 (failure propagation)
**Package:** `@sverka/workflow` (model: `compensation` field), `@sverka/sdk` (`.compensate()` builder), `@sverka/runtime` (engine: compensation phase)
**Bead:** sv-wthn.3.4
**Depends on:** sv-wthn.1.2 (RetryPolicy — compensation is a step-level execution wrapper, same layer)
**Related:** ADR-013, Spec 10 (engine-native), Spec 21 (RunEvent), Spec 20 (RetryPolicy)

## Overview

When a run ends in `failure`, the native engine runs **compensation
operations** for succeeded steps that declared one, in reverse completion
order. A compensation undoes a step's side effects (e.g. rollback a deploy,
delete a created resource). Inspired by the Temporal saga pattern, but
deliberately simpler: no compensation transactions, no forward recovery,
no per-branch scoping — just ordered rollback of completed work.

Each step MAY declare a `compensation: OperationDefinition` (v1: `shell`
only). The engine tracks the order steps succeed; on run failure it walks
that list backwards and executes each compensation via the step's own
runtime driver in the step's workspace. Compensation failures are
non-fatal — a failed compensation emits a `warn` diagnostic but does not
block subsequent compensations.

Native engine only (v1). CI targets are `emulated`: the compiled workflow
runs `sverka execute`, which uses the native engine for compensation at
runtime. Native `if: failure()` lowering is a follow-up bead.

## Goals

- `compensation?: OperationDefinition` added to `StepDefinition`, `StepProps`,
  and the `Step` class; propagated by `synthesize()`.
- `StepBuilder.compensate(command: string): StepBuilder` in `@sverka/sdk` —
  sets `compensation` to `{ kind: "shell", command }`.
- Engine compensation phase: after the schedule ends with `hasFailure`
  (and the run is not cancelled), run compensations for succeeded steps
  that have one, in reverse completion order, before `run-completed`.
- New `RunEvent` variants: `step-compensating`, `step-compensated`.
- Synthesis validation: `compensation.kind` must be `"shell"` (v1); other
  kinds raise `SynthesisError(INVALID_COMPENSATION)`.
- `policy.compensation` capability: native engine `native`; GHA `emulated`;
  GitLab `emulated`.

## Non-goals

- Native target lowering (`if: failure()` jobs / `when: on_failure` rules)
  — follow-up bead; v1 targets are `emulated`.
- Compensation for `cancelled` runs — cancellation is intentional; only
  `failure` triggers compensation.
- Compensation retries / backoff — a compensation runs once; failure is
  non-fatal. (If a compensation needs retry, the command itself implements
  it.)
- Per-branch / per-entry DAG scoping — v1 compensates ALL succeeded steps
  with a declared compensation, in reverse completion order. Branch-aware
  scoping is a follow-up.
- Forward recovery / retry-as-compensation — out of scope; compensation is
  strictly rollback.
- Compensation in the legacy `runtime/` scheduler — not extended (ADR-011).
- Compensation ordering by DAG topology — completion order is used (simpler,
  and correct for the common linear/branch case).

## Interfaces

### Model (`@sverka/workflow` cdk)

```ts
// StepDefinition gains:
readonly compensation?: OperationDefinition;   // v1: { kind: "shell", command }

// StepProps gains:
readonly compensation?: OperationDefinition;

// Step class gains:
readonly compensation?: OperationDefinition;
```

`OperationDefinition` is the existing union (Spec 02). Only `kind: "shell"`
is valid for `compensation` in v1 (validated at synthesis).

### SDK (`@sverka/sdk`)

```ts
export interface StepBuilder {
  // ...existing methods...
  compensate(command: string): StepBuilder;   // sets compensation: { kind: "shell", command }
}
```

`$("deploy").compensate("rollback.sh")` declares a compensation command.

### Engine (`@sverka/runtime` engine-native)

No new public interfaces. The compensation phase is internal to the engine,
invoked at the end of `executeRun` when the final status is `failure`.

### Run events (extends Spec 21)

```ts
| { readonly type: "step-compensating"; readonly stepId: string; readonly command: string }
| { readonly type: "step-compensated"; readonly stepId: string; readonly status: "succeeded" | "failed"; readonly durationMs: number }
```

## Data models

### Synthesis

- `Step.compensation` → `StepDefinition.compensation` via
  `collectStepOptionalFields` (same pattern as `retry`, `cache`).
- Validation (`validateStep`): if `compensation` is set and
  `compensation.kind !== "shell"`, raise
  `SynthesisError(INVALID_COMPENSATION)`.

### Engine — compensation phase

1. `runSchedule` completes. The engine computes `status`:
   `cancelled` → no compensation; `failure` → run compensation;
   `success` → no compensation.
2. If `status === "failure"`: call `runCompensations(ctx)`.
3. `runCompensations` iterates `ctx.completionOrder` (a `string[]` of
   succeeded step ids, appended in `runStep` on success) in **reverse**.
4. For each step id where `step.compensation` is set and
   `ctx.states.get(id) === "succeeded"`:
   - Emit `step-compensating { stepId, command }`.
   - Execute the compensation shell command via the step's runtime driver
     in the step's workspace (`resolveUnder(workspace, .sverka/workspace/<id>)`),
     with the step's `runtime` (env, secrets, image, shell, network).
   - On success: emit `step-compensated { stepId, status: "succeeded", durationMs }`.
   - On failure: emit `step-compensated { stepId, status: "failed", durationMs }`
     + a `diagnostic` (warn) — continue to the next compensation.
5. Compensation is **serial** (one at a time, in reverse order). No
   concurrency.
6. After all compensations, emit `run-completed { status: "failure" }`.

### Completion order tracking

`RunContext` gains `completionOrder: string[]`. In `runStep`, on the
`result.status === "succeeded"` branch, append `step.id` to
`completionOrder` before `onStepComplete`. Cache-hit successes also append
(the step succeeded). Skipped/failed/cancelled steps are NOT appended.

## Error handling

- `INVALID_COMPENSATION` (`SynthesisError`): `compensation.kind` is not
  `"shell"`. Raised at validate time.
- Compensation execution failure: **non-fatal**. The engine emits
  `step-compensated { status: "failed" }` + a `warn` diagnostic and
  continues. The run still completes with status `failure` (the triggering
  failure stands).
- No new `EngineError` codes — compensation failure is a normal `failed`
  shell result, not an engine error.
- No runtime driver for a compensation step (should not happen — drivers
  are stable for the run — but defensive): emit a `warn` diagnostic and
  skip that compensation; continue to the next.
- Cancellation during compensation: if the abort signal fires mid-
  compensation, the current compensation is allowed to finish (its driver
  call is awaited), remaining compensations are skipped, and `run-completed`
  emits `status: "cancelled"`. (A cancelled run does not require rollback.)

## Test plan

1. `Step` with `compensation: { kind: "shell", command: "cleanup.sh" }`
   synthesizes to a `StepDefinition` with that `compensation` field.
2. `$("deploy").compensate("rollback.sh")` builds a `ShellStep` with
   `compensation: { kind: "shell", command: "rollback.sh" }`.
3. Synthesis raises `INVALID_COMPENSATION` when `compensation.kind` is not
   `"shell"` (e.g. `"exportOutput"`).
4. Engine run where a downstream step fails: succeeded upstream steps with
   `compensation` have their compensation commands executed, in **reverse
   completion order** (verify via driver call order).
5. A step with no `compensation` is skipped during the compensation phase
   (no `step-compensating` event for it).
6. A `failed` step with `compensation` does NOT have its compensation run
   (it didn't complete).
7. A `skipped` step with `compensation` does NOT have its compensation run.
8. Run that ends `success`: no compensation events emitted.
9. Run that ends `cancelled`: no compensation events emitted.
10. Compensation command that fails (exit code ≠ 0): emits
    `step-compensated { status: "failed" }` + a `warn` diagnostic;
    subsequent compensations still run.
11. `step-compensating` event carries the `command` string;
    `step-compensated` carries `status` and `durationMs`.
12. Compensation runs in the step's workspace with the step's runtime
    (env/secrets/image) — verify the driver receives the step's
    `RuntimeDefinition`.
13. Cache-hit success: a step that succeeded via cache hit is included in
    the compensation phase (appended to `completionOrder`).
14. `policy.compensation` capability: native engine `native`, GHA
    `emulated`, GitLab `emulated`.
15. `compensation` field exported from `@sverka/workflow` (via
    `StepDefinition`); `compensate` method exported from `@sverka/sdk`
    (via `StepBuilder`).
