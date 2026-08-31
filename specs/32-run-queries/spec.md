# Spec 32 — Run Queries

**Status:** Active
**Source:** v1 mega-plan (sv-wthn.3.3); architecture spec §21 (Engine Contract), §22.2 (step states)
**Package:** `@sverka/runtime` (engine-native: `Engine.query`, `RunState`)
**Bead:** sv-wthn.3.3
**Depends on:** sv-wthn.3.1 (suspend/resume — defines `RunStatus` `"suspended"` and the step `suspended` state that `RunState` surfaces)
**Related:** ADR-015, Spec 10 (engine-native), Spec 21 (RunEvent), Spec 29 (suspend/resume), Spec 28 (mcp-server — consumer)

## Overview

A read-only **query** of a run's current state: which steps are pending,
running, succeeded, failed, and the overall run status. The engine already
tracks this state internally (`RunContext.states`); the query surfaces a
point-in-time snapshot without consuming the `RunEvent` stream.

This is the **read side** of the mega-plan's "signals & queries" item. The
**write side** (signals — async messages to a running run) is **deferred**:
suspend/resume (Spec 29) covers "wait for external input" durably;
`Engine.cancel()` covers "stop the run"; mid-execution signal delivery to
shell steps has no clean model in Sverka's batch-operation scheduler (see
ADR-015). Queries ship now because they are cheap (the state is already
in memory) and have a concrete consumer (the MCP server `run.status` tool,
Spec 28; a future `sverka status` CLI command).

## Goals

- `Engine.query(runId?: string): RunState | undefined` — returns a snapshot
  of the active run's state. Omit `runId` (or pass the active run's id) for
  the in-progress run; returns `undefined` when no run is active or the
  `runId` does not match.
- `RunState` model: `{ runId, planId, status, startedAt, steps }`.
- `RunState.status`: `"running" | RunStatus` (where `RunStatus` is the
  terminal status from Spec 21/29: `"success" | "failure" | "cancelled" |
  "suspended"`). `"running"` is the non-terminal state surfaced only by
  `query` — it is **not** added to `RunStatus` (which is terminal-only).
- `RunState.steps`: one entry per step with `{ stepId, state, durationMs? }`.
  `state` is the engine's `StepState` union (Spec 22.2 / scheduler), which
  gains `"suspended"` when Spec 29 is implemented.
- The engine tracks a lightweight `currentRun` reference (set on
  `run-started`, cleared on `run-completed`) so `query` can snapshot
  `RunContext.states` without exposing the internal context.
- `run.query` capability: native engine `native`; GHA `emulated`; GitLab
  `emulated` (the compiled workflow runs `sverka execute`, which uses the
  native engine).

## Non-goals

- **Signals (write side) — deferred.** `Engine.signal(name, payload)` is
  not in v1. Suspend/resume + cancel cover the write side. A non-durable
  in-process signal wait is an anti-pattern for CI (process death loses
  the wait); durable waits use suspend. Revisit for the M3 hosted engine
  where runs are long-lived. See ADR-015.
- **Named query handlers.** The mega-plan's `Run.query(name)` (Temporal-
  style registered query handlers) is deferred. v1 ships one unnamed
  state-snapshot query. Named handlers are a follow-up if a concrete
  consumer emerges.
- **Querying suspended runs via the engine.** A suspended run is no longer
  active in memory; its state is the persisted `RunSnapshot`, available via
  `SnapshotStore.load(runId)` (Spec 29/31). `Engine.query` returns
  `undefined` for a suspended run. (Coupling `query` to `SnapshotStore`
  would blur the active-vs-persisted boundary for no v1 value.)
- **Querying completed runs / run history.** `query` reflects the active
  run only. History is a follow-up (the SQLite store from Spec 31 is the
  seam).
- **Multi-run engines.** The native engine is single-active-run (§22,
  enforced by the `activeRun` guard). `query` reflects that one run. The
  optional `runId` parameter is forward-compat for the M3 hosted engine.
- **Wire transport for query** (HTTP/SSE `GET /runs/:id`) — follow-up; v1
  query is a programmatic `Engine.query()` call.

## Interfaces

### Engine (`@sverka/runtime` engine-native)

```ts
export interface RunState {
  readonly runId: string;
  readonly planId: string;
  readonly status: "running" | RunStatus;   // RunStatus from Spec 21/29
  readonly startedAt: number;               // epoch ms (matches run-started)
  readonly steps: readonly {
    readonly stepId: string;
    readonly state: StepState;              // engine's step-state union (Spec 22.2 / scheduler)
    readonly durationMs?: number;           // present for succeeded/failed steps
  }[];
}

export interface Engine {
  run(request: RunRequest): AsyncIterable<RunEvent>;
  resume(request: ResumeRequest): AsyncIterable<RunEvent>;   // Spec 29
  cancel(): Promise<void>;
  query(runId?: string): RunState | undefined;               // NEW
}
```

`query` is **synchronous**: the state is in memory. It returns `undefined`
when no run is active, or when `runId` is provided and does not match the
active run's id.

`StepState` is the existing union from the scheduler
(`"pending" | "ready" | "running" | "succeeded" | "failed" | "cancelled" |
"skipped"`); it gains `"suspended"` when Spec 29 is implemented. `RunState`
references it by type, so it tracks the engine's actual states without
duplicating the union.

### Exports

`RunState` is exported from `@sverka/runtime/src/index.ts`. `query` is a
member of the `Engine` interface (already exported). No new SDK/CDK surface
— a query is an engine-level concern, not an authoring concern.

## Data models

### Engine — query path

1. On `run-started`, the engine stores a `currentRun` reference:
   `{ runId, planId, startedAt, ctx }` where `ctx` is the live `RunContext`.
2. `query(runId?)`:
   - If `currentRun` is unset → return `undefined`.
   - If `runId` is provided and `runId !== currentRun.runId` → return
     `undefined`.
   - Otherwise, snapshot `currentRun.ctx.states` (a `Map<string,
     StepState>`) into `RunState.steps`, compute `status`:
     - If the run has not yet emitted `run-completed` → `"running"`.
     - If `run-completed` was emitted → the terminal `RunStatus`.
   - `durationMs` per step is taken from the step's result when present
     (succeeded/failed steps carry it; the engine already records it in
     `step-succeeded`/`step-failed` events).
3. On `run-completed`, the engine clears `currentRun` (after the event is
   emitted, so a `query` racing with completion returns the terminal state
   for the active run, then `undefined` thereafter).

### Concurrency

`query` reads a `Map` that the scheduler mutates. The native engine is
single-threaded JS (no worker threads); `query` is called between async
ticks of the scheduler, so no locking is needed. The snapshot is a shallow
copy of the states map entries (step ids + state strings + optional
number) — cheap and safe.

## Error handling

- `query` does not throw. Unknown/no-active run → `undefined`.
- No new error codes. `query` is a pure read; it cannot fail in a way that
  warrants an `EngineError`.
- If `currentRun.ctx` is in an inconsistent state (should not happen — the
  scheduler updates states atomically per step transition), `query` still
  returns a best-effort snapshot; a step mid-transition reflects its
  pre-transition state (the consumer observes it on the next query or via
  the event stream).

## Test plan

1. `Engine.query()` before any run → `undefined`.
2. `Engine.query()` during an active run (between `run-started` and
   `run-completed`) → `RunState` with `status: "running"`, the run's
   `runId`/`planId`/`startedAt`, and one entry per step in its current
   `StepState`.
3. `Engine.query(activeRunId)` during the active run → same as #2.
4. `Engine.query("unknown-id")` during an active run → `undefined` (runId
   mismatch).
5. `Engine.query()` after `run-completed` (status `success`) → `undefined`
   (currentRun cleared).
6. `RunState.steps` reflects a mid-run snapshot: with a 3-step linear plan
   where step 1 succeeded and step 2 is running, `query()` returns step 1
   `succeeded` (with `durationMs`), step 2 `running`, step 3 `pending`.
7. `RunState.status` is `"running"` mid-run and would be the terminal
   `RunStatus` if queried in the same tick as `run-completed` (test by
   querying inside a `for await` loop right before the final event —
   engine clears `currentRun` after emitting `run-completed`).
8. A failed step appears with `state: "failed"` and `durationMs` present.
9. A skipped step appears with `state: "skipped"`, no `durationMs`.
10. `RunState` is exported from `@sverka/runtime`; `query` is a member of
    the exported `Engine` interface (type-level test: assign a
    `RunState`-shaped object).
11. `run.query` capability: native engine `native`, GHA `emulated`, GitLab
    `emulated`.
12. No `any` in the `RunState` definition or `query` implementation
    (`unknown` + narrowing if needed).
