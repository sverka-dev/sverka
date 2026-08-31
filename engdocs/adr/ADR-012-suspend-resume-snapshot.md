# ADR-012 — Suspend/Resume: Snapshot-based, Terminal Suspend

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-011 (canonical runtime), Spec 29, Spec 21 (RunEvent)

## Context

v1 Wave 3 adds Human-in-the-Loop (HITL) durability: a step can suspend a
run, persist state, and wait for external input; a later resume call
continues. The mega-plan requires "snapshot-based, simpler than Temporal"
(inspired by Mastra suspend/resume).

Two design axes:

1. **What state is captured?** Event sourcing (every operation result) vs.
   a single snapshot (completed steps + outputs + suspended step).
2. **How does resume re-enter a step?** Mid-step (operation-index
   checkpointing, re-run ops after the suspend point) vs. terminal suspend
   (suspend is the last op; the step does not re-run; resume data becomes a
   step output).

## Decision

1. **Snapshot, not event sourcing.** The `RunSnapshot` captures completed
   steps and their scalar outputs (ValueStore), the suspended step id, and
   the resume schema. Artifacts are not copied — they persist on disk in
   `artifactDir` and are reused on resume. This is sufficient to resume
   scheduling downstream steps.

2. **Suspend is terminal for the step's first execution.** A `suspend`
   operation must be the **last** operation in its step (enforced at
   synthesis: `SUSPEND_NOT_LAST`). Pre-suspend operations run normally and
   their exported outputs are captured in the snapshot. On resume the
   suspended step is marked succeeded with its pre-suspend outputs plus the
   injected `resume` output — it does **not** re-run. Work that must happen
   after resume belongs in a downstream step that depends on the suspended
   step.

3. **One suspended step per run (v1).** When a step suspends, in-flight
   concurrent steps are awaited (their outputs captured) before the
   snapshot is persisted. Concurrent suspend is a non-goal.

4. **`SnapshotStore` interface, in-memory default.** sv-wthn.3.1 ships
   `SnapshotStore` (`save`/`load`/`delete`) + `InMemorySnapshotStore`.
   Persistent adapters (SQLite) are sv-wthn.3.2.

5. **Engine-native only.** The legacy `runtime/` scheduler is not extended
   (ADR-011). CI targets emulate: the compiled workflow runs `sverka
   execute`, which uses the native engine for suspend/resume at runtime.

## Rationale

Terminal suspend avoids operation-level checkpointing — the complexity that
makes Temporal heavy. The HITL use case (request input → resume → downstream
acts on it) is fully covered: a `SuspendStep` requests input; downstream
steps consume `${suspendStepId}.resume`. A step that must do work before
suspending either (a) puts that work in a prior step, or (b) uses a custom
step with `[...ops, suspend]` — pre-suspend exports are captured. Post-
resume work always goes in a downstream step.

Snapshot (not event sourcing) keeps the persistence surface small: one
record per suspended run, no replay log, no operation-result stream. The
trade-off is no mid-step resume — acceptable for v1 HITL.

## Consequences

- `OperationDefinition` gains a `SuspendOperation` kind.
- `RunEvent` gains `step-suspended`, `run-suspended`, `run-resumed`;
  `RunStatus` gains `"suspended"`.
- `Engine` gains `resume(request)`. `RunRequest` gains optional
  `snapshotStore`.
- The engine's run state must be refactorable into a `RunContext` that can
  be built both fresh and from a snapshot (the main implementation cost).
- `suspend.resume` capability: native engine `native`; GHA/GitLab
  `emulated`.
- Follow-ups: SQLite snapshot store (sv-wthn.3.2), signals (sv-wthn.3.3),
  saga (sv-wthn.3.4), GHA/GitLab native lowering (workflow_run / parent-
  child pipelines), wire transport for resume.
