# Spec 21 — RunEvent Protocol

**Status:** Active
**Source:** specs/architecture-spec.md §21 (Engine Contract), §22.2 (Step states), §22 component 10
**Package:** `@sverka/runtime` (engine-native sub-module)
**Related:** ADR-011, Spec 10 (engine-native), Spec 19 (CacheStore), Spec 20 (RetryPolicy)

## Overview

The typed streaming event protocol emitted by the native engine via
`Engine.run(): AsyncIterable<RunEvent>`. The protocol is **already
implemented** (10 event types in `engine-native/types.ts`); this spec
formalizes it and adds two Wave 1 variants — `step-cache-hit` (Spec 19) and
`step-retry` (Spec 20) — completing the protocol needed for observability
and Wave 3 HITL (suspend/resume consumes events).

## Goals

- Formalize the existing 10 event types as the canonical protocol.
- Add `step-cache-hit` and `step-retry` variants.
- Document event ordering guarantees.
- Export the full `RunEvent` union from `@sverka/runtime`.

## Non-goals

- Wire-level transport (WebSocket, SSE) — out of scope; consumers pull from
  the `AsyncIterable`.
- Event persistence/replay — Wave 3 (RunSnapshot storage).
- Backfill events for the legacy `runtime/` scheduler — not extended
  (ADR-011).

## Interfaces

```ts
type RunEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly planId: string }
  | { readonly type: "step-pending"; readonly stepId: string }
  | { readonly type: "step-ready"; readonly stepId: string }
  | { readonly type: "step-started"; readonly stepId: string }
  | { readonly type: "step-succeeded"; readonly stepId: string; readonly durationMs: number }
  | { readonly type: "step-failed"; readonly stepId: string; readonly error: string; readonly durationMs: number }
  | { readonly type: "step-skipped"; readonly stepId: string }
  | { readonly type: "step-cancelled"; readonly stepId: string }
  | { readonly type: "step-cache-hit"; readonly stepId: string; readonly key: string }   // NEW (Spec 19)
  | { readonly type: "step-retry"; readonly stepId: string; readonly attempt: number; readonly nextAttemptMs: number } // NEW (Spec 20)
  | { readonly type: "run-completed"; readonly runId: string; readonly status: RunStatus; readonly durationMs: number }
  | { readonly type: "diagnostic"; readonly stepId: string; readonly message: string; readonly severity: "info" | "warn" | "error" };

type RunStatus = "success" | "failure" | "cancelled";
```

## Data models

Event ordering guarantees:

1. `run-started` is always first.
2. `run-completed` is always last.
3. Every step emits `step-pending` before any other step event for that id.
4. A step that hits cache emits `step-cache-hit` then `step-succeeded`
   (no `step-ready`/`step-started`).
5. A retried step emits `step-started` once, then `step-retry` before each
   re-run, then a terminal `step-succeeded`/`step-failed`.
6. `diagnostic` events may appear at any time (stepId `""` = run-level).

## Error handling

No error class. The engine yields a `diagnostic` (severity `error`) +
`run-completed` (status `failure`) for setup failures instead of throwing
through the async iterator. Cache/store best-effort failures surface as
`diagnostic` (severity `warn`).

## Test plan

1. A full run emits `run-started` first and `run-completed` last.
2. Each step emits `step-pending` before its other events.
3. Cache hit (Spec 19) emits `step-cache-hit` then `step-succeeded`, with no
   `step-ready`/`step-started` for that step.
4. Retry (Spec 20) emits `step-retry` with `attempt` and `nextAttemptMs`
   before each re-run.
5. Setup failure (no driver) yields `diagnostic` (error) + `run-completed`
   (failure) — no throw from the iterator.
6. `RunEvent` and `RunStatus` exported from `@sverka/runtime`.
7. Existing engine tests still pass (10-event behavior unchanged).
