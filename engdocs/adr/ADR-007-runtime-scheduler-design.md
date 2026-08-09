# ADR-007: Runtime Scheduler Design

**Status:** Accepted
**Date:** 2026-08-09
**Spec:** `specs/03-runtime/spec.md`

## Context

Wave 3 implements the `@sverka/runtime` package: the `Executor` interface and
the `Scheduler` that drives a canonical `Plan` (from `@sverka/ir`). The
runtime must be backend-agnostic (concrete executors are later waves) and
testable with mocks. The original spec draft included resource pools, state
persistence, cache reuse, critical-check prioritization, and retry as
mandatory features with required config fields.

## Decisions

### 1. `StateStore`, `CacheBackend`, and resource limits are optional config

`SchedulerConfig.stateStore`, `cache`, `totalCpu`, and `totalMemory` are
optional (`?`). When omitted, the scheduler skips persistence, caching, and
resource limiting respectively. Only `maxConcurrent` is required.

**Rationale:** No concrete executor or file-backed backend exists yet. Making
these mandatory would force every caller (including tests and simple CLI
runs) to pass no-op implementations. Optional fields let the Scheduler work
out of the box for the common case and opt into advanced features when a
backend is available. This removes the need for `NoOpStateStore`/
`NoOpCacheBackend` classes (YAGNI).

### 2. `ResourcePool` is internal, not exported

The `ResourcePool` interface exists in `internal/resource-pool.ts` but is not
in the public surface. The `Scheduler` creates it internally from
`totalCpu`/`totalMemory` when configured.

**Rationale:** No external consumer implements or references `ResourcePool`.
Exporting it would be speculative public API. The `Executor` interface is the
public extension point; resource accounting is an internal scheduling detail.

### 3. Critical-check prioritization is deferred

The original spec required prioritizing operations tagged `critical` when
resources are contended. This is cut from Wave 3.

**Rationale:** The IR `PlanOperation` (`sverka.dev/v1`) has no `critical` or
`tags` field (confirmed in `packages/ir/src/plan.ts`). Implementing
prioritization would require either an IR schema change (Wave 2 is done and
shipped) or an invented heuristic with no backing data. YAGNI — the scheduler
executes in topological order with concurrency, which is sufficient for v1.
Follow-up issue filed when a concrete need arises.

### 4. `OperationOutcome` name overlaps with `@sverka/core`

The runtime exports its own `OperationOutcome` (execution-time: no `"planned"`
status, `error?: string`, `fromCache: boolean`). Core exports a planning-time
`OperationOutcome` (status includes `"planned"`, `error?: CoreError`).

**Rationale:** They are distinct types at distinct layers. Core's
`OperationOutcome` is the result of evaluating an `OperationSpec` during
graph evaluation (plan/execute/compile modes). The runtime's is the result of
executing a `PlanOperation` through an `Executor`. The name overlap is
intentional — each is the natural outcome type for its layer. Consumers
import from the package whose layer they use; the runtime does not import
core's `OperationOutcome`.

### 5. `@sverka/runtime` depends on `@sverka/ir` only

The runtime imports `Plan` and `PlanOperation` from `@sverka/ir`. It does not
directly import any `@sverka/core` type — `OperationKind` flows transitively
through `PlanOperation.kind`.

**Rationale:** `dependencies.md` rule 3 lists core as a runtime dependency,
but the spec uses no core type directly. Adding an unused workspace dep
violates the "only depend on what you use" principle. If a concrete need for
a core type emerges during implementation, add the dep then and update this
ADR. `dependencies.md` should be updated to reflect the actual dep graph if
the deviation holds.

## Consequences

- The Scheduler is usable with a minimal config (`executors`, `maxConcurrent`,
  paths, `credentials`, `resume`).
- Tests provide in-test mock `StateStore`/`CacheBackend`/`Executor`
  implementations; no mock classes ship in the package.
- The public surface is smaller: `ResourcePool` is not exported.
- Critical-check prioritization is a known gap with a follow-up path (add
  `tags`/`critical` to IR v2, then implement in the scheduler).
- The `OperationOutcome` name collision is documented; no rename needed
  because the packages serve different layers.
