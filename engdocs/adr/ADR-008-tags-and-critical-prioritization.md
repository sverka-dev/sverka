# ADR-008: Tags field and critical-check prioritization

Date: 2026-08-10
Status: Implemented
Supersedes: ADR-007 (partially — resolves the deferred critical-check prioritization)

## Context

ADR-007 (runtime scheduler design) deferred critical-check prioritization
because the IR PlanOperation had no `tags` or `critical` field. The scheduler
processed ready operations in input order, with no way to prioritize
critical checks ahead of non-critical when the resource pool was contended.

The `OperationSpec` in `@sverka/core` already had an optional `tags?: readonly
string[]` field, but it was never propagated to the IR `PlanOperation` or
used by the scheduler.

## Decision

1. **Add `tags?: readonly string[]` to `PlanOperation` (IR)** — optional,
   defaults to absent. No schema version bump needed (additive, optional
   field).

2. **Pass `tags` through in `convertToPlan` (SDK)** — `convertOperation`
   copies `spec.tags` to the `PlanOperation` when present.

3. **Prioritize critical-tagged ops in `topoSort` (runtime)** — among
   ready siblings (ops with all dependencies satisfied), ops with
   `"critical"` in their `tags` array are scheduled first. Input order
   is preserved within each priority group (stable sort).

## Implementation

- `packages/ir/src/plan.ts`: added `tags?: readonly string[]` to `PlanOperation`
- `packages/sdk/src/convert.ts`: `convertOperation` passes `spec.tags` through
- `packages/runtime/src/internal/topo.ts`: `sortReadyByPriority()` helper
  sorts the ready queue: critical first, then input order

## Alternatives considered

- **`critical: boolean` field** — rejected. A dedicated boolean is less
  flexible than tags. Tags support multiple categories (security, critical,
  fast) and can be used for filtering and categorization beyond
  prioritization.

- **Priority queue with numeric priority** — rejected. Over-engineered for
  the current use case. A simple "critical first, then input order" is
  sufficient and deterministic.

- **Scheduler-level prioritization (not topoSort)** — rejected. The
  scheduler iterates in topo order; prioritizing at the topo level ensures
  the order is correct before the scheduler's launch loop sees it.

## Consequences

- Ops without `tags` behave exactly as before (input order among siblings).
- Ops with `tags` but without `"critical"` behave exactly as before.
- Ops with `"critical"` tag are scheduled ahead of non-critical siblings.
- The `tags` field is available for future features: filtering, categorization,
  compiler-specific metadata.
