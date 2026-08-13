# Spec 10 — Engine Native

**Status:** Active
**Source:** specs/architecture-spec.md §21, §22, §14
**Package:** `@sverka/engine-native` (rebuilt from `@sverka/runtime`)

## Overview

The native engine is the reference implementation of Sverka execution
semantics (§22). It consumes a `RunPlan` directly, schedules the Step DAG,
executes ordered Operations inside each Step via runtime drivers, transfers
scalar outputs and artifacts between Steps, resolves secrets, emits
structured run events, and supports cancellation.

## Goals

- `Engine` class implementing `run(plan): AsyncIterable<RunEvent>` + `cancel()`
- Scheduler: topological sort of Steps by dependency edges, concurrent
  execution up to `maxConcurrent`, deterministic failure propagation
- StepExecutor: runs ordered Operations (shell, exportOutput, exportArtifact,
  importArtifact, diagnostic) inside one Step
- `RuntimeDriver` interface: `executeShell(request)` — host or OCI execution
- `ValueStore`: in-memory scalar output transfer between Steps
- `ArtifactStore`: filesystem-based artifact transfer between Steps
- `SecretProvider` interface: resolves secret references
- `RunEvent` discriminated union: step state changes + run completion
- Step states: pending, ready, running, succeeded, failed, skipped, cancelled
- Timeout enforcement per Step
- Cancellation: stop pending and running work

## Non-goals

- Planner (Wave G — binds Entry+Trigger+Inputs into RunPlan)
- Cache (§32 — deferred from v0)
- Retry policy (§32 — deferred from v0)
- State persistence/resume (not required for v0)
- Resource pools / CPU-memory limits (not required for v0)
- Distributed workers (§22.5)
- Remote scheduling (§22.5)
- Provider UI emulation (§22.5)
- Concurrency groups (§32)

## Interfaces

```ts
import type { RunPlan, StepDefinition, InputValue } from "@sverka/ir";
import type { Runtime } from "@sverka/constructs";

// --- Engine ---

interface RunRequest {
  readonly plan: RunPlan;
  readonly workspace: string;       // root workspace dir
  readonly artifactDir: string;     // artifact store root
  readonly secrets?: SecretProvider;
  readonly drivers?: readonly RuntimeDriver[];
  readonly maxConcurrent?: number;  // default: number of CPU cores
}

interface Engine {
  run(request: RunRequest): AsyncIterable<RunEvent>;
  cancel(): Promise<void>;
}

// --- Run events (§22.2 step states) ---

type RunEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly planId: string }
  | { readonly type: "step-pending"; readonly stepId: string }
  | { readonly type: "step-ready"; readonly stepId: string }
  | { readonly type: "step-started"; readonly stepId: string }
  | { readonly type: "step-succeeded"; readonly stepId: string; readonly durationMs: number }
  | { readonly type: "step-failed"; readonly stepId: string; readonly error: string; readonly durationMs: number }
  | { readonly type: "step-skipped"; readonly stepId: string }
  | { readonly type: "step-cancelled"; readonly stepId: string }
  | { readonly type: "run-completed"; readonly runId: string; readonly status: RunStatus; readonly durationMs: number }
  | { readonly type: "diagnostic"; readonly stepId: string; readonly message: string; readonly severity: "info" | "warn" | "error" };

type RunStatus = "success" | "failure" | "cancelled";

// --- Runtime driver ---

interface RuntimeDriver {
  readonly name: string;
  canExecute(step: StepDefinition): boolean;
  executeShell(request: ShellExecuteRequest): Promise<ShellResult>;
  dispose?(): Promise<void>;
}

interface ShellExecuteRequest {
  readonly command: string;
  readonly workspace: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly image?: string;        // OCI image ref (container drivers)
  readonly mode?: "host" | "container";
}

interface ShellResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

// --- Value store (scalar output transfer) ---

interface ValueStore {
  set(stepId: string, outputName: string, value: InputValue): void;
  get(stepId: string, outputName: string): InputValue | undefined;
}

// --- Artifact store (file/directory output transfer) ---

interface ArtifactStore {
  store(stepId: string, outputName: string, sourcePath: string): Promise<string>;
  retrieve(stepId: string, outputName: string, destPath: string): Promise<string>;
}

// --- Secret provider ---

interface SecretProvider {
  resolve(name: string): Promise<string | undefined>;
}

// --- Engine config ---

interface EngineConfig {
  readonly drivers: readonly RuntimeDriver[];
  readonly maxConcurrent?: number;
}
```

### Functions

```ts
function createEngine(config: EngineConfig): Engine;
function createValueStore(): ValueStore;
function createArtifactStore(rootDir: string): ArtifactStore;
```

### Exports

```ts
export type { Engine, RunRequest, RunEvent, RunStatus, RuntimeDriver,
  ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore,
  SecretProvider, EngineConfig };
export { createEngine, createValueStore, createArtifactStore };
export { EngineError, SchedulerError, StepExecError };
export type { EngineErrorCode };
```

## Data models

**Scheduling**: Steps are topologically sorted by their `dependencies` arrays.
A Step becomes ready when all producers it depends on have succeeded. A
control dependency requires the producer to succeed. A value or artifact
dependency requires the producer to succeed AND the specific output to be
available in the ValueStore/ArtifactStore.

**Step execution**: The StepExecutor creates a per-step workspace directory
under `request.workspace/<stepId>/`. It sets `SVERKA_OUTPUT_DIR` env var
pointing to a per-step output directory. For each operation in order:
- `shell`: call `driver.executeShell(command, env, workspace, timeout)`
- `exportOutput`: read `$SVERKA_OUTPUT_DIR/<name>`, parse by type, store in
  ValueStore
- `exportArtifact`: copy from workspace path to ArtifactStore
- `importArtifact`: copy from ArtifactStore to step workspace
- `diagnostic`: emit a diagnostic RunEvent

**Scalar output capture**: Shell commands write output values to
`$SVERKA_OUTPUT_DIR/<name>`. The StepExecutor reads these files on
`exportOutput`. String values are the file content trimmed. Number values
are parsed via `Number()`. Boolean values are `"true"` → true, else false.

**Failure propagation**: When a Step fails, all Steps that depend on it
(transitively) are cancelled. The run continues if the failed Step has no
dependents that are roots — but for v0, any failure marks the run as failed.

**Cancellation**: `cancel()` sets a flag. Running shell processes receive
SIGTERM. Pending Steps are marked cancelled. The run completes with status
`cancelled`.

**Driver selection**: The engine iterates `config.drivers` and selects the
first whose `canExecute(step)` returns true. If no driver matches, the Step
fails with `NO_DRIVER`.

## Error handling

```ts
class EngineError extends Error {
  override readonly cause: unknown;
  readonly code: EngineErrorCode;
}

type EngineErrorCode = "SCHEDULER_ERROR" | "STEP_EXEC_ERROR" | "NO_DRIVER"
  | "TIMEOUT" | "OUTPUT_CAPTURE_ERROR" | "ARTIFACT_ERROR";
```

`SchedulerError`: cycle detected, invalid DAG.
`StepExecError`: shell command failed, output capture failed, artifact
transfer failed.
`NO_DRIVER`: no runtime driver can execute the step.

## Test plan

1. `createEngine`: returns an Engine with run() and cancel().
2. Engine runs a single-step plan: emits run-started, step-started,
   step-succeeded, run-completed.
3. Engine runs a multi-step plan with dependencies: steps execute in
   topological order.
4. Engine runs steps concurrently when no dependencies exist (up to
   maxConcurrent).
5. Step failure propagates: dependents are cancelled, run status is failure.
6. Cancellation: cancel() stops pending steps, running step gets SIGTERM,
   run status is cancelled.
7. Timeout: step with timeout exceeds limit → step-failed with timeout error.
8. ValueStore: set/get scalar outputs.
9. ArtifactStore: store/retrieve files between steps.
10. exportOutput operation: captures scalar from $SVERKA_OUTPUT_DIR.
11. exportArtifact operation: copies file to ArtifactStore.
12. importArtifact operation: copies file from ArtifactStore to workspace.
13. diagnostic operation: emits diagnostic RunEvent.
14. Driver selection: first matching driver is used; no driver → step fails.
15. Step states: pending → ready → running → succeeded/failed/cancelled.
16. Error classes: EngineError base, override readonly cause.
17. Public API: all exports present, no any types.
