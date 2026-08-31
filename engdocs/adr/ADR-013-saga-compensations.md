# ADR-013 — Saga Compensations: Reverse Completion-Order Rollback

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-011 (canonical runtime), ADR-012 (suspend/resume), Spec 30, Spec 20 (RetryPolicy), Spec 21 (RunEvent)

## Context

v1 Wave 3 (sv-wthn.3.4) adds saga-style compensations: when a run fails,
succeeded steps that declared a compensation operation run their rollback
in reverse order. The mega-plan calls for "compensation field to
StepDefinition; on downstream failure, compensations run in reverse order;
native engine: compensation executor; CI targets: emulated via additional
jobs. Inspired by Temporal saga pattern."

Three design axes:

1. **What triggers compensation?** Any step failure (run ends `failure`)
   vs. only failures of downstream dependents vs. explicit user-declared
   rollback points.
2. **What ordering?** Reverse DAG topological order vs. reverse completion
   order vs. per-branch scoped.
3. **What scope?** All succeeded steps vs. only steps on the path to the
   failure vs. per-entry isolation.

## Decision

1. **Any run failure triggers compensation.** When the run's final status
   is `failure` (and not `cancelled`), the engine runs compensations for
   all succeeded steps that declared one. We do NOT scope to "steps on the
   path to the failure" — computing that in a DAG with branches and
   fan-out is complex, and the common case (linear deploy pipeline) is
   unaffected. Simpler semantics, correct for the v1 use case.

2. **Reverse completion order, not DAG topology.** The engine tracks the
   order steps actually succeeded (`completionOrder`) and walks it
   backwards. This is simpler than computing a reverse topo-sort at
   compensation time (the schedule already ran; completion order is the
   ground truth) and correct for linear and branch cases: later-completed
   steps are rolled back before earlier ones.

3. **All succeeded steps with a declared compensation.** No path
   analysis, no branch scoping. A step that succeeded and declared a
   compensation gets compensated on run failure. Per-branch scoping is a
   follow-up if real usage demands it.

4. **`compensation?: OperationDefinition` on `StepDefinition`.** v1
   constrains to `kind: "shell"` (validated at synthesis:
   `INVALID_COMPENSATION`). The field is `OperationDefinition`, not a
   bare `string`, to stay forward-compatible if future operation kinds
   become valid compensations (e.g. `diagnostic` for audit-only rollback).
   The SDK `.compensate(command: string)` builder wraps the string into
   `{ kind: "shell", command }` so the common case stays ergonomic.

5. **Compensation failure is non-fatal.** A compensation that fails (exit
   ≠ 0) emits a `warn` diagnostic and `step-compensated { status: "failed"
   }` but does not abort the compensation phase. The run already failed;
   a failed rollback should not prevent other rollbacks. (If a rollback
   must be reliable, the command itself implements retry.)

6. **Serial execution.** Compensations run one at a time in reverse
   order. No concurrency. Saga rollback is inherently ordered;
   parallelizing adds complexity for no v1 value.

7. **Native engine only; targets emulated.** Consistent with ADR-012
   (suspend/resume). The compiled GHA/GitLab workflow runs `sverka
   execute`, which uses the native engine for compensation at runtime.
   Native `if: failure()` / `when: on_failure` lowering is a follow-up
   bead — it requires computing transitive dependents at lower time to
   express "compensate when a downstream job fails" in `needs`/`if`, which
   is non-trivial and not justified for a P2 feature in v1.

8. **No compensation for cancelled runs.** Cancellation is intentional
   termination, not a failure requiring rollback. Only `failure` triggers
   the compensation phase.

## Rationale

Temporal sagas are heavy: compensation transactions, forward recovery,
activity-level checkpointing. Sverka's v1 need is narrower — "undo
completed work when a pipeline fails" — which is fully covered by ordered
rollback of shell commands. Completion-order tracking is nearly free (one
array append per succeeded step) and avoids a second topological analysis
at failure time.

Constraining to `kind: "shell"` keeps validation trivial and the engine
path uniform (one `driver.executeShell` call per compensation). Lifting
the constraint later is backward-compatible (existing shell compensations
are unaffected).

Non-fatal compensation failure matches operational reality: a rollback
script that itself fails should not cascade. The `warn` diagnostic
surfaces the failure for observability without blocking cleanup.

## Consequences

- `StepDefinition` / `StepProps` / `Step` gain `compensation?: OperationDefinition`.
- `StepBuilder` gains `.compensate(command: string)`.
- `RunEvent` gains `step-compensating`, `step-compensated`.
- `RunContext` (internal) gains `completionOrder: string[]`.
- `SynthesisErrorCode` gains `INVALID_COMPENSATION`.
- `policy.compensation` capability: native engine `native`; GHA/GitLab
  `emulated`.
- Follow-ups: native target lowering (`if: failure()` jobs), per-branch
  scoping, compensation retries, compensation for partial-failure
  (continueOnError) scenarios.
