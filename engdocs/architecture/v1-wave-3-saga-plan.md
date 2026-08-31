# v1 Wave 3 — Saga Compensations (sv-wthn.3.4) — Implementation Plan

**Spec:** specs/30-saga/spec.md
**ADR:** ADR-013
**Base branch:** v1-w3-durability (stacks on Wave 2; design is branch-independent — no source touched)
**Packages touched:** `@sverka/workflow`, `@sverka/sdk`, `@sverka/runtime`, `@sverka/compiler` (capability manifests only)

## Scope

Model field + SDK builder + engine compensation phase + capability manifest
updates. No new packages. No target lowering (emulated). ~120 impl lines +
~250 test lines.

## Files

### `@sverka/workflow` (packages/workflow/src)
- `cdk/constructs.ts` — add `compensation?: OperationDefinition` to
  `StepProps`, `Step` class, `OPTIONAL_STEP_PROPS`.
- `cdk/model.ts` — no new type (reuses `OperationDefinition`); re-export
  not needed (already exported via graph.ts).
- `core/graph.ts` — add `compensation?: OperationDefinition` to
  `StepDefinition`.
- `core/synthesize.ts` — add `["compensation", step.compensation]` to
  `collectStepOptionalFields`.
- `core/validate.ts` — add `validateCompensation(step)`: if
  `step.compensation && step.compensation.kind !== "shell"` →
  `SynthesisError(INVALID_COMPENSATION)`.
- `core/errors.ts` — add `INVALID_COMPENSATION` to `SynthesisErrorCode`.
- `cdk/__tests__/model.test.ts` — export assertion for `compensation` on
  `StepDefinition` (if not already covered by graph re-export test).

### `@sverka/sdk` (packages/sdk/src)
- `dollar.ts` — add `compensate(command: string): StepBuilder` to
  `StepBuilder` interface + `createBuilder`; store in `StepBuilderState`;
  pass to `ShellStep` props in `build()`.
- `__tests__/dollar.test.ts` (or equivalent) — `.compensate()` builds a
  step with the compensation field.

### `@sverka/runtime` (packages/runtime/src/engine-native)
- `types.ts` — add `step-compensating` and `step-compensated` to `RunEvent`;
  add `completionOrder: string[]` to the `RunContext` shape (internal, not
  exported on `Engine`).
- `engine.ts`:
  - `RunContext` interface: add `completionOrder: string[]`.
  - `executeRun`: initialize `completionOrder: []` in the context.
  - `runStep`: on `result.status === "succeeded"` (both normal and
    cache-hit branches), append `step.id` to `ctx.completionOrder`.
  - After `runSchedule` + `drainEvents`, compute `status`. If
    `status === "failure"` and not cancelled: `yield* runCompensations(ctx)`.
  - New private generator `*runCompensations(ctx)`: iterate
    `ctx.completionOrder` in reverse; for each id with
    `step.compensation` and state `succeeded`, emit `step-compensating`,
    execute the compensation shell command via the step's driver in the
    step's workspace with the step's runtime, emit `step-compensated`.
    On failure emit `diagnostic` (warn). Serial.
- `__tests__/compensation.test.ts` (new) — test plan items 4–13.

### `@sverka/compiler` (packages/compiler/src) — capability manifests
- `github/capabilities.ts` — add `"policy.compensation": "emulated"`.
- `gitlab/capabilities.ts` — add `"policy.compensation": "emulated"`.
- `__tests__` — update capability count assertions if any.

## TDD steps

1. **Model field + synthesis.** Write test: `Step` with `compensation`
   synthesizes to `StepDefinition` with `compensation`. Add field to
   `StepProps`/`Step`/`StepDefinition`/`collectStepOptionalFields`. Green.
2. **Validation.** Write test: non-shell `compensation.kind` raises
   `INVALID_COMPENSATION`. Add `validateCompensation` + error code. Green.
3. **SDK builder.** Write test: `.compensate("rollback.sh")` sets
   `compensation: { kind: "shell", command: "rollback.sh" }`. Add method
   to `StepBuilder`. Green.
4. **Engine — completion order.** Write test: succeeded steps appear in
   `completionOrder` in success order; failed/skipped do not. Add
   `completionOrder` to `RunContext`, append in `runStep`. Green.
5. **Engine — compensation phase triggers on failure.** Write test: a
   3-step linear plan (A→B→C) where C fails; A and B have compensations.
   Assert compensations run in reverse order (B then A). Add
   `runCompensations` + wire into `executeRun`. Green.
6. **Engine — no compensation on success/cancel.** Write tests: success
   run → no compensation events; cancelled run → no compensation events.
   Green.
7. **Engine — compensation failure is non-fatal.** Write test: first
   compensation fails (exit 1) → `warn` diagnostic + `step-compensated
   { status: "failed" }`; second compensation still runs. Green.
8. **Engine — failed/skipped steps not compensated.** Write test: a failed
   step with compensation is NOT compensated; a skipped step with
   compensation is NOT compensated. Green.
9. **Engine — cache-hit step compensated.** Write test: step succeeds via
   cache hit → appears in completionOrder → compensation runs on failure.
   Green.
10. **Engine — workspace + runtime.** Write test: compensation command
    receives the step's workspace path and runtime env. Green.
11. **Capability manifests.** Write test: `policy.compensation` is
    `emulated` for both targets. Add manifest entries. Green.
12. **Gates.** `bun run test && bun run typecheck && bun run lint && bun
    run build` — all green across affected packages.

## Notes for the builder

- `OperationDefinition` is imported from `@sverka/workflow` (graph.ts
  re-exports it). The `compensation` field type is `OperationDefinition`,
  not a new type.
- The compensation shell execution reuses `driver.executeShell` with a
  `ShellExecuteRequest` built from the step's `runtime` — mirror
  `buildStepExecOptions` but for a single shell command (the compensation
  command). No `executeStep` (that runs ordered operations); compensation
  is a single shell call.
- `RunContext` is an internal interface in `engine.ts`. Adding
  `completionOrder` does not change any public export.
- The `step-compensating`/`step-compensated` events are added to the
  `RunEvent` union in `types.ts` — they ARE public (RunEvent is exported).
- Commit hygiene: stage only the files listed above + specs/30-saga/ +
  engdocs/architecture/v1-wave-3-saga-plan.md + engdocs/adr/ADR-013;
  EXCLUDE city.toml/agents/.devin/.gc/.beads/formulas and any concurrent
  Wave 2 uncommitted work.
