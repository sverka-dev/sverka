# Spec 29 — Suspend/Resume (Snapshot-based)

**Status:** Active
**Source:** v1 mega-plan (sv-wthn.3); architecture spec §21 (Engine Contract), §22 (Native Engine)
**Package:** `@sverka/workflow` (model: `SuspendOperation`, `SuspendStep`), `@sverka/sdk` (`suspend` builder), `@sverka/runtime` (engine: suspend/resume, `SnapshotStore`, `RunSnapshot`)
**Bead:** sv-wthn.3.1
**Depends on:** sv-wthn.1.3 (RunEvent — suspend consumes the event protocol)
**Related:** ADR-012, Spec 10 (engine-native), Spec 21 (RunEvent), Spec 27 (AgentStep — operation-kind pattern)

## Overview

A step can **suspend** a run: pause execution, persist a snapshot, and wait
for external input. A later **resume** call reloads the snapshot, injects the
resume data as the suspended step's output, and continues scheduling
downstream steps. Native engine only (v1). CI targets emulate via the
compiled workflow running `sverka execute` (which uses the native engine).

Snapshot-based — not event sourcing. The snapshot captures completed steps
and their scalar outputs, the suspended step id, and the resume schema. No
operation-level checkpointing: **`suspend` must be the last operation in a
step**; pre-suspend operations run normally and their exported outputs are
captured in the snapshot. On resume the step is marked succeeded with its
pre-suspend outputs plus the injected `resume` output — it does **not**
re-run. Work that must happen after resume belongs in a downstream step
that depends on the suspended step.

Inspired by Mastra suspend/resume.

## Goals

- `SuspendOperation` added to `OperationDefinition` union: `{ kind:
  "suspend"; output?: string; resumeSchema?: ResumeSchema }`.
- `SuspendStep` class in cdk (extends `Step`); `SuspendStepProps`.
- `suspend()` SDK builder (returns `SuspendStepBuilder`).
- `ResumeSchema`: `{ readonly required?: readonly string[] }` — minimal
  validation of parsed JSON resume data.
- `RunSnapshot` model + `SnapshotStore` interface (`save`/`load`/`delete`) +
  `InMemorySnapshotStore` (for tests; SQLite adapter is sv-wthn.3.2).
- `Engine.resume(request): AsyncIterable<RunEvent>` — loads snapshot,
  injects resume data, continues the run.
- `RunRequest` gains optional `snapshotStore?: SnapshotStore` (required for
  any run that may suspend).
- New `RunEvent` variants: `step-suspended`, `run-suspended`, `run-resumed`.
  `RunStatus` gains `"suspended"`.
- Synthesis validation: `suspend` must be the last operation in a step;
  auto-adds the resume output declaration (type `string`) if absent.
- `suspend.resume` capability: native engine `native`; GHA `emulated`;
  GitLab `emulated`.

## Non-goals

- Snapshot persistence adapters (SQLite, Postgres) — sv-wthn.3.2.
- Operation-level checkpointing / resume-mid-step — explicitly excluded
  (suspend is terminal for the step's first execution).
- Concurrent suspend (multiple steps suspended at once) — v1 allows one
  suspended step per run; in-flight concurrent steps are awaited before the
  snapshot is persisted.
- Signals (external events on running, non-suspended workflows) —
  sv-wthn.3.3.
- Saga compensations — sv-wthn.3.4.
- Suspend/resume in the legacy `runtime/` scheduler — not extended
  (ADR-011); engine-native only.
- Wire transport for resume (HTTP/SSE endpoint to submit resume data) —
  follow-up; v1 resume is a programmatic `Engine.resume()` call.
- GHA/GitLab native lowering of suspend (workflow_run / parent-child
  pipelines) — follow-up bead; v1 targets are `emulated` (run `sverka
  execute`).
- Resume data streaming / partial resume — v1 resume data is a single
  string payload.

## Interfaces

### Model (`@sverka/workflow` cdk)

```ts
export interface ResumeSchema {
  readonly required?: readonly string[];   // top-level JSON keys that must be present
}

export interface SuspendOperation {
  readonly kind: "suspend";
  readonly output?: string;        // output name holding the resume data; default "resume"
  readonly resumeSchema?: ResumeSchema;
}
```

`OperationDefinition` union gains `SuspendOperation`.

```ts
export interface SuspendStepProps extends StepProps {
  readonly output?: string;         // default "resume"
  readonly resumeSchema?: ResumeSchema;
}

export class SuspendStep extends Step {
  readonly output: string;
  readonly resumeSchema?: ResumeSchema;
  constructor(scope: Pipeline, id: string, props?: SuspendStepProps);
}
```

`SuspendStep` synthesizes to a `StepDefinition` with a single `suspend`
operation and a declared string output named `output` (default `"resume"`).
Its `runtime` is `host` (no work to execute).

### SDK (`@sverka/sdk`)

```ts
export interface SuspendStepBuilder {
  output(name: string): SuspendStepBuilder;
  schema(resumeSchema: ResumeSchema): SuspendStepBuilder;
  dependsOn(steps: readonly string[]): SuspendStepBuilder;
  inputs(inputs: readonly Reference[]): SuspendStepBuilder;
  build(pipeline: Pipeline, id: string): SuspendStep;
}

export function suspend(id?: string): SuspendStepBuilder;
```

`suspend("approval")` creates a builder; `.schema({ required: ["decision"] })`
sets the resume schema. The `id` is optional at the builder and required at
`build(pipeline, id)` (mirrors the `$` builder pattern).

### Engine (`@sverka/runtime` engine-native)

```ts
export interface RunSnapshot {
  readonly runId: string;
  readonly planId: string;
  readonly plan: RunPlan;
  readonly completedSteps: readonly {
    readonly stepId: string;
    readonly outputs: Readonly<Record<string, InputValue>>;
  }[];
  readonly suspendedStepId: string;
  readonly resumeSchema?: ResumeSchema;
  readonly suspendedAt: number;        // epoch ms
  readonly status: "suspended";
}

export interface SnapshotStore {
  save(snapshot: RunSnapshot): Promise<void>;
  load(runId: string): Promise<RunSnapshot | undefined>;
  delete(runId: string): Promise<void>;
}

export function createInMemorySnapshotStore(): SnapshotStore;
```

```ts
export interface ResumeRequest {
  readonly runId: string;
  readonly data: string;               // resume payload (JSON string when schema present)
  readonly snapshotStore: SnapshotStore;
  readonly workspace: string;
  readonly artifactDir: string;
  readonly secrets?: SecretProvider;
  readonly drivers?: readonly RuntimeDriver[];
  readonly maxConcurrent?: number;
  readonly cache?: CacheStore;
}

export interface Engine {
  run(request: RunRequest): AsyncIterable<RunEvent>;
  resume(request: ResumeRequest): AsyncIterable<RunEvent>;
  cancel(): Promise<void>;
}
```

`RunRequest` gains `readonly snapshotStore?: SnapshotStore`.

### Run events (extends Spec 21)

```ts
| { readonly type: "step-suspended"; readonly stepId: string; readonly resumeSchema?: ResumeSchema }
| { readonly type: "run-suspended"; readonly runId: string; readonly suspendedStepId: string; readonly durationMs: number }
| { readonly type: "run-resumed"; readonly runId: string; readonly planId: string }

type RunStatus = "success" | "failure" | "cancelled" | "suspended";
```

## Data models

### Synthesis

- `SuspendStep` → `StepDefinition` with one `suspend` operation and a
  string output named `output` (default `"resume"`).
- A custom step may include a `suspend` operation as its **last** operation
  only. Synthesis raises `SynthesisError(SUSPEND_NOT_LAST)` if a `suspend`
  op is followed by any other operation.
- If the step does not declare the resume output, synthesis auto-adds it
  (type `string`).

### Engine — suspend path

1. `runStep` reaches a `suspend` operation.
2. The step is marked `suspended`; `step-suspended` is emitted (with
   `resumeSchema`).
3. The engine awaits any other in-flight steps (their results are captured).
4. The engine builds a `RunSnapshot`: completed steps + their scalar outputs
   (from the `ValueStore`), the suspended step id, `resumeSchema`,
   `suspendedAt`. Artifacts are **not** copied — they persist on disk in
   `artifactDir` and are reused on resume.
5. The snapshot is persisted via `request.snapshotStore.save(snapshot)`.
   If no `snapshotStore` was provided, the step fails with
   `SUSPEND_WITHOUT_STORE` (diagnostic error) and the run completes with
   status `failure`.
6. `run-suspended` is emitted; the `run()` async generator **ends** (the
   run is paused, not completed).

### Engine — resume path

1. `resume(request)` loads the snapshot via `snapshotStore.load(runId)`.
   If not found: yield `diagnostic` (error) + `run-completed` (failure).
2. If `resumeSchema.required` is set: parse `request.data` as JSON and
   verify all required keys are present. On failure: yield `diagnostic`
   (error) + `run-completed` (failure) with `INVALID_RESUME_DATA`.
3. Reconstruct the `ValueStore` from `snapshot.completedSteps`. Reconstruct
   the `ArtifactStore` from the same `artifactDir`.
4. Mark the suspended step `succeeded`; set its `resume` output (named by
   the suspend op) to `request.data` in the `ValueStore`.
5. Emit `run-resumed` (same `runId`/`planId`), then `step-succeeded` for
   the resumed step, then continue scheduling downstream steps exactly as
   `run()` does.
6. Emit `run-completed` with the final status (`success`/`failure`/
   `cancelled`).
7. On successful completion, delete the snapshot
   (`snapshotStore.delete(runId)`).

### Resume data exposure

The resume data is a `string` stored as the suspended step's `resume`
output. Downstream steps reference it via a value `StepRef`
(`${stepId}.resume`). For structured data the caller passes a JSON string;
downstream steps parse it (in shell or via an expression). The
`resumeSchema.required` check validates the JSON shape at resume time.

## Error handling

- `SUSPEND_NOT_LAST` (`SynthesisError`): a `suspend` operation is not the
  last operation in its step. Raised at synthesize/validate time.
- `SUSPEND_WITHOUT_STORE` (`EngineError`): a step suspends but
  `RunRequest.snapshotStore` was not provided. Step fails; run completes
  `failure`.
- `INVALID_RESUME_DATA` (`EngineError`): resume data fails the
  `resumeSchema.required` check (not valid JSON, or a required key
  missing). `resume()` yields `diagnostic` (error) + `run-completed`
  (failure); the snapshot is **not** deleted (the caller may retry resume).
- `SNAPSHOT_NOT_FOUND` (`EngineError`): `resume()` cannot load the
  snapshot. `run-completed` (failure).
- No new error class beyond extending `EngineError`/`SynthesisError` codes.
  All use `override readonly cause`.

## Test plan

1. `SuspendStep` synthesizes to a `StepDefinition` with a `suspend`
   operation and a string output named `resume` (default).
2. `SuspendStep` with `output: "approval"` synthesizes with that output
   name.
3. `suspend("approval").schema({ required: ["decision"] })` builds a
   `SuspendStep` with the resume schema.
4. Synthesis raises `SUSPEND_NOT_LAST` when a `suspend` op is followed by
   another operation.
5. Engine run with a plan containing a `SuspendStep`: emits `step-suspended`
   then `run-suspended`; the `run()` generator ends; snapshot persisted to
   the `SnapshotStore`.
6. Engine run with a `SuspendStep` but no `snapshotStore`: step fails with
   `SUSPEND_WITHOUT_STORE`; run completes `failure`.
7. `Engine.resume` with valid data: emits `run-resumed`, `step-succeeded`
   for the resumed step, runs downstream steps, emits `run-completed`
   (`success`); snapshot deleted.
8. `Engine.resume` with `resumeSchema.required` and missing key: emits
   `diagnostic` (error) + `run-completed` (`failure`); snapshot retained.
9. `Engine.resume` with unknown `runId`: `SNAPSHOT_NOT_FOUND`; run-completed
   `failure`.
10. Downstream step references `${suspendStepId}.resume`: receives the
    resume data string on resume.
11. Pre-suspend outputs: a custom step with `[exportOutput: x, suspend]`
    — on resume the downstream step sees both `x` and `resume`.
12. In-flight concurrent steps at suspend time are awaited and their outputs
    captured in the snapshot.
13. `RunStatus` includes `"suspended"`; `run-suspended` event carries
    `suspendedStepId`.
14. `SuspendOperation`, `SuspendStep`, `SuspendStepProps`, `ResumeSchema`
    exported from `@sverka/workflow`.
15. `suspend`, `SuspendStepBuilder` exported from `@sverka/sdk`.
16. `RunSnapshot`, `SnapshotStore`, `ResumeRequest`, `createInMemorySnapshotStore`
    exported from `@sverka/runtime`.
17. `suspend.resume` capability: native engine `native`, GHA `emulated`,
    GitLab `emulated`.
