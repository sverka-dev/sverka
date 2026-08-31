# v1 Wave 3 Plan — Suspend/Resume

**Spec:** 29-suspend-resume
**Bead:** sv-wthn.3.1
**Packages:** `@sverka/workflow` (model: `SuspendOperation`, `SuspendStep`), `@sverka/sdk` (`suspend` builder), `@sverka/runtime` (engine: suspend/resume, `SnapshotStore`, `RunSnapshot`, in-memory store)
**Date:** 2026-08-31
**Base branch:** `v1-w3-durability` (stacks on Wave 2)
**ADR:** ADR-012

## Scope

Add snapshot-based suspend/resume to the native engine. New
`OperationDefinition` kind `"suspend"`. `SuspendStep` cdk class + `suspend()`
SDK builder. `SnapshotStore` interface + `InMemorySnapshotStore` (SQLite
adapter is sv-wthn.3.2). `Engine.resume()` method. Three new `RunEvent`
variants; `RunStatus` gains `"suspended"`.

## Design decision (ADR-012)

`suspend` is **terminal for the step's first execution** — it must be the
last operation in a step. Pre-suspend operations run normally and their
exported outputs are captured in the snapshot. On resume the step is marked
succeeded with pre-suspend outputs + the injected `resume` output; it does
**not** re-run. Post-resume work belongs in a downstream step. This avoids
operation-level checkpointing (the complexity that makes Temporal heavy)
while covering the HITL use case (request input → resume → downstream acts
on it).

## Package dependency

```text
@sverka/sdk          →  @sverka/workflow   (SuspendStep, SuspendStepProps, ResumeSchema)
@sverka/runtime      →  @sverka/workflow   (SuspendOperation in OperationDefinition; RunPlan)
```

No new external deps. `InMemorySnapshotStore` uses a `Map`. SQLite adapter
(`sv-wthn.3.2`) will add `better-sqlite3`.

## Files

| File | Action |
|---|---|
| `packages/workflow/src/cdk/model.ts` | **Edit** — add `ResumeSchema`, `SuspendOperation` interfaces. |
| `packages/workflow/src/cdk/constructs.ts` | **Edit** — add `SuspendStepProps`, `SuspendStep` class (extends `Step`). |
| `packages/workflow/src/cdk/index.ts` | **Edit** — export `ResumeSchema`, `SuspendOperation`, `SuspendStepProps`, `SuspendStep`. |
| `packages/workflow/src/core/graph.ts` | **Edit** — add `SuspendOperation` to `OperationDefinition` union. |
| `packages/workflow/src/core/synthesize.ts` | **Edit** — `SuspendStep` → `StepDefinition` with `suspend` op + auto-add resume output; validate `suspend` is last op (`SUSPEND_NOT_LAST`). |
| `packages/workflow/src/core/errors.ts` | **Edit** — add `SUSPEND_NOT_LAST` to `SynthesisErrorCode`. |
| `packages/sdk/src/suspend.ts` | **New** — `suspend()` builder + `SuspendStepBuilder`. |
| `packages/sdk/src/index.ts` | **Edit** — export `suspend`, `SuspendStepBuilder`. |
| `packages/runtime/src/engine-native/types.ts` | **Edit** — add `RunSnapshot`, `SnapshotStore`, `ResumeRequest` interfaces; `snapshotStore?` on `RunRequest`; `resume()` on `Engine`; new `RunEvent` variants; `"suspended"` on `RunStatus`. |
| `packages/runtime/src/engine-native/snapshot-store.ts` | **New** — `createInMemorySnapshotStore`. |
| `packages/runtime/src/engine-native/snapshot.ts` | **New** — `buildSnapshot()` + `restoreSnapshot()` helpers (pure). |
| `packages/runtime/src/engine-native/engine.ts` | **Edit** — suspend path in `runStep` (emit `step-suspended`, await in-flight, persist, emit `run-suspended`, end generator); `resume()` method (load, validate, restore, continue scheduling). |
| `packages/runtime/src/engine-native/step-executor.ts` | **Edit** — handle `op.kind === "suspend"`: stop the operation loop and return `StepExecResult` with `status: "suspended"` (pre-suspend `exportOutput` ops already wrote to the `ValueStore`). |
| `packages/runtime/src/engine-native/errors.ts` | **Edit** — add `SUSPEND_WITHOUT_STORE`, `INVALID_RESUME_DATA`, `SNAPSHOT_NOT_FOUND` to `EngineErrorCode`. |
| `packages/runtime/src/engine-native/index.ts` | **Edit** — export `RunSnapshot`, `SnapshotStore`, `ResumeRequest`, `createInMemorySnapshotStore`. |
| `packages/compiler/src/github/capabilities.ts` | **Edit** — add `suspend.resume: "emulated"`. |
| `packages/compiler/src/gitlab/capabilities.ts` | **Edit** — add `suspend.resume: "emulated"`. |
| `packages/workflow/src/cdk/__tests__/suspend-step.test.ts` | **New** — model/synthesize tests (items 1–4, 14). |
| `packages/sdk/src/__tests__/suspend.test.ts` | **New** — SDK builder tests (items 3, 15). |
| `packages/runtime/src/engine-native/__tests__/suspend-resume.test.ts` | **New** — engine suspend/resume tests (items 5–13, 16). |
| `packages/compiler/src/github/__tests__/capabilities.test.ts` | **Edit** — assert `suspend.resume: "emulated"` (item 17). |
| `packages/compiler/src/gitlab/__tests__/capabilities.test.ts` | **Edit** — assert `suspend.resume: "emulated"` (item 17). |

## TDD steps

1. Add `ResumeSchema` + `SuspendOperation` to cdk/model.ts + export from
   cdk/index.ts. Add `SuspendOperation` to `OperationDefinition` union in
   graph.ts. Add `SUSPEND_NOT_LAST` to `SynthesisErrorCode`. Write item 14
   (export assertion).
2. Add `SuspendStepProps` + `SuspendStep` class to constructs.ts. Wire
   `synthesize`: `SuspendStep` → `StepDefinition` with `suspend` op +
   auto-added string output. Add `SUSPEND_NOT_LAST` validation. Write items
   1, 2, 4 (synthesize default output, custom output, suspend-not-last).
3. Write `suspend.ts` SDK builder + `SuspendStepBuilder`. Export from sdk
   index. Write items 3, 15 (builder schema, export).
4. Add `RunSnapshot`, `SnapshotStore`, `ResumeRequest` to engine-native
   types.ts; `snapshotStore?` on `RunRequest`; `resume()` on `Engine`; new
   `RunEvent` variants (`step-suspended`, `run-suspended`, `run-resumed`);
   `"suspended"` on `RunStatus`. Add error codes. Write item 13, 16 (export
   assertions).
5. Write `snapshot-store.ts` — `createInMemorySnapshotStore`. Write
   `snapshot.ts` — `buildSnapshot` (collect completed steps + ValueStore
   outputs) + `restoreSnapshot` (rebuild ValueStore).
6. Engine suspend path: `step-executor` throws a `SuspendSignal` (internal,
   not exported) on `op.kind === "suspend"`; `engine.runStep` catches it,
   emits `step-suspended`, awaits in-flight steps, builds + persists
   snapshot, emits `run-suspended`, ends the generator. Write items 5, 6,
   12 (suspend emits events + persists; no-store fails; in-flight awaited).
7. Engine `resume()`: load snapshot, validate resume data against
   `resumeSchema.required`, restore ValueStore, mark suspended step
   succeeded with resume output, continue scheduling, emit `run-resumed` +
   `run-completed`, delete snapshot on success. Write items 7, 8, 9, 10, 11
   (resume success, invalid data, unknown runId, downstream ref, pre-suspend
   outputs).
8. Add `suspend.resume: "emulated"` to both capability manifests. Write
   item 17.
9. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
   `bun run build` for `@sverka/workflow`, `@sverka/sdk`,
   `@sverka/runtime`, `@sverka/compiler`. Full monorepo green.

## Implementation notes

- **StepExecResult `"suspended"`**: the executor returns `status:
  "suspended"` when it reaches a `suspend` op (it stops the operation loop
  normally — no throw-for-control-flow). Pre-suspend `exportOutput` ops
  have already written to the `ValueStore`, so the engine reads partial
  outputs from the store when building the snapshot.
- **Generator end on suspend**: `run()` returns (generator closes) after
  `run-suspended`. The run is not "completed" — it is paused. `run-completed`
  is NOT emitted on the suspend path.
- **Resume reuses the scheduling core**: extract the scheduling loop from
  `run()` into a shared `scheduleFromSnapshot(ctx, startStepIds)` helper so
  both `run()` and `resume()` drive the same scheduler. Minimal duplication.
- **Artifacts not snapshotted**: artifacts live on disk in `artifactDir`;
  resume reuses the same dir. Only scalar outputs (ValueStore) are
  serialized into the snapshot. Document that `artifactDir` must be stable
  across suspend/resume.
- **One suspended step per run**: if a second step attempts to suspend while
  the run is already suspending, it is treated as a normal step failure
  (`SUSPEND_WITHOUT_STORE`-style guard: `RUN_ALREADY_SUSPENDING`). v1
  constraint; concurrent suspend is a non-goal.

## Risks

- **Engine state extraction**: the current engine holds run state in local
  closures inside `run()`. Resume requires reconstructing that state from a
  snapshot. Mitigation: refactor run state into a `RunContext` object that
  can be built both fresh (`run`) and from a snapshot (`resume`). This is
  the bulk of the implementation work.
- **Snapshot size**: serializing all completed scalar outputs. v1 runs are
  small (CI steps); acceptable. Large-output runs are a follow-up concern.
