# ADR-015 — Run Queries in v1; Signals Deferred

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-011 (canonical runtime), ADR-012 (suspend/resume), Spec 32, Spec 29 (suspend/resume), Spec 21 (RunEvent), architecture spec §21 (Engine Contract)

## Context

v1 Wave 3 task sv-wthn.3.3 (from the mega-plan) calls for "Run.signal(name,
payload) and Run.query(name)" — Temporal-style signals (async messages to
a running run) and queries (read-only state inspection), inspired by
Temporal signals/queries/updates.

Two questions:

1. **Does the write side (signals) earn its place in v1?** Signals are
   async messages to a *running* run: "approval", "cancel", "update".
2. **Does the read side (queries) earn its place?** Queries are read-only
   state inspection of a running run.

The authoritative architecture spec §21 (Engine Contract) mandates only
`run(request)` and `cancel(runId)`. Neither signals nor queries appear in
it — both come from the mega-plan (a planning doc, not authoritative).

## Decision

1. **Ship queries in v1; defer signals.** `Engine.query(runId?)` returns a
   `RunState` snapshot of the active run (Spec 32). `Engine.signal(...)` is
   not in v1.

2. **The write side is already covered.**
   - **approval** → suspend/resume (Spec 29 / ADR-012): a step suspends,
     persists a snapshot, and an external actor calls `Engine.resume()` with
     the approval data. This is the *durable* HITL mechanism — the right
     one for CI, where the gap between "request input" and "receive input"
     can be hours and span a process restart.
   - **cancel** → `Engine.cancel()` (already in the Engine contract, §21).
   - **update** (mutate a running run's config mid-execution) → no concrete
     v1 use case; dynamically reconfiguring a running CI step is complex
     and not requested by any consumer. YAGNI.

3. **Mid-execution signal delivery has no clean model in Sverka.** Temporal
   signals work because a workflow is a long-running *function* that can
   `await` a signal channel. Sverka steps are **batch operations** (shell
   commands, agent calls) executed by a DAG scheduler. There is no
   long-running step function that can park on a signal:
   - A non-durable, in-process signal wait (step blocks until
     `engine.signal(name)` resolves it) is an **anti-pattern for CI**: if
     the process dies, the wait is lost with no snapshot to resume from.
     Suspend is the durable alternative and already exists.
   - Delivering a signal *into* a running shell command would require a new
     mechanism (signal files, env injection, polling) with unclear
     semantics and no concrete consumer.

4. **Queries are cheap and have a real consumer.** The engine already
   tracks `RunContext.states` (a `Map<stepId, StepState>`); `query` is a
   shallow snapshot of it. The MCP server (Spec 28) can expose a
   `run.status` tool over `query`; a future `sverka status` CLI command
   consumes it. The cost is one interface method + one snapshot function;
   the value is observability of an in-progress run without replaying the
   event stream from the start.

5. **Unnamed query, not named query handlers.** The mega-plan's
   `Run.query(name)` (Temporal-style registered handlers) is deferred. v1
   ships one unnamed state-snapshot query — the only thing any concrete
   consumer needs. A named-handler registry is speculative until a consumer
   asks for custom queries.

6. **`Engine.query` reflects the active run only.** A suspended run is no
   longer in memory; its state is the persisted `RunSnapshot` (loadable via
   `SnapshotStore.load`, Spec 29/31). Coupling `query` to `SnapshotStore`
   would blur the active-vs-persisted boundary for no v1 value. Completed
   runs return `undefined` from `query`; history is a follow-up over the
   SQLite store (Spec 31).

7. **Native engine only; targets emulated.** Consistent with ADR-012
   (suspend/resume) and ADR-013 (saga). The compiled GHA/GitLab workflow
   runs `sverka execute`, which uses the native engine for `query` at
   runtime. A native `workflow_dispatch`-based status job is a follow-up.

## Rationale

The architect's mandate is to design what's correct, not what was asked.
The mega-plan bundled signals and queries because Temporal has both, but
Sverka is not Temporal: it is a batch CI runtime with a DAG scheduler, not
a long-running workflow function engine. Lifting Temporal's signal model
verbatim would import complexity (signal handlers, in-process wait points,
delivery into running steps) that fights Sverka's execution model and
duplicates suspend/resume on the write side.

Queries survive the cut because they are a pure read over state the engine
already holds, with a concrete consumer (MCP `run.status`). Signals are
deferred, not killed: the M3 hosted engine — where runs are long-lived in
a control plane and a signal channel is natural — is the right home for
them. ADR-012 already provides the durable HITL path for v1.

## Consequences

- `Engine` gains `query(runId?: string): RunState | undefined` (Spec 32).
- `RunState` is exported from `@sverka/runtime`.
- `RunStatus` is unchanged (terminal-only); `RunState.status` adds
  `"running"` locally without polluting `RunStatus`.
- The engine tracks a `currentRun` reference (set on `run-started`, cleared
  on `run-completed`).
- `run.query` capability: native engine `native`; GHA/GitLab `emulated`.
- **No** `Engine.signal`, no `SignalDefinition`, no signal-handler
  registration, no `waitForSignal` operation kind in v1.
- Follow-ups: signals for the M3 hosted engine; named query handlers if a
  consumer needs custom queries; `sverka status` CLI command; wire
  transport (`GET /runs/:id`) for the hosted control plane; run history
  over the SQLite store.
