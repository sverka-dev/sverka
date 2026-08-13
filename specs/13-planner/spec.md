# Spec 13 — Planner

**Status:** Active
**Source:** specs/architecture-spec.md §10, §22.1 (component 1), §23
**Package:** `@sverka/planner` (rebuilt)

## Overview

The Planner binds a Definition Graph's Entry + Trigger + user-supplied
inputs + context values into a concrete `RunPlan` that the native engine
can execute. It is §22.1 component 1. It also reuses project discovery
from the existing planner package (git inspection, language detection,
signal collection).

## Goals

- `bindRunPlan(graph, entry, inputs)` → `RunPlan`
  - Selects reachable Steps from the Entry's roots (transitive closure
    over dependency edges)
  - Resolves pipeline inputs to concrete `InputValue`s
  - Computes deterministic Run Plan ID via `computeRunPlanId`
  - Computes graph ID via `computeGraphId`
  - Sets `createdAt` to current ISO timestamp
- `discover(options)` → `ProjectContext` (reused from existing planner)
- `plan(context)` → `PlanProposal` (reused from existing planner)
- Reachability: transitive closure from Entry roots over `dependencies[].producer`
- Input binding: merge pipeline input defaults with user-supplied overrides
- Validation: entry exists, roots exist, all reachable steps reference
  valid producers

## Non-goals

- Trigger evaluation (the planner receives an already-selected Entry)
- Condition evaluation (conditions are evaluated at runtime by the engine)
- Matrix expansion (§32 — deferred from v0)
- Proposed-check → Step synthesis (Wave J — Checks integration)
- Target lowering (Wave H/I)
- Execution (Wave F — engine-native)

## Interfaces

```ts
import type { DefinitionGraph } from "@sverka/core";
import type { RunPlan, InputValue } from "@sverka/ir";

interface BindRunPlanOptions {
  readonly graph: DefinitionGraph;
  readonly entryId: string;
  readonly inputs?: Readonly<Record<string, InputValue>>;
}

interface Planner {
  discover(options: DiscoverOptions): Promise<ProjectContext>;
  plan(context: ProjectContext): Promise<PlanProposal>;
  bindRunPlan(options: BindRunPlanOptions): RunPlan;
}

function createPlanner(): Planner;
function bindRunPlan(options: BindRunPlanOptions): RunPlan;
function computeReachableSteps(
  steps: readonly StepDefinition[],
  roots: readonly string[],
): readonly StepDefinition[];
```

### Exports

```ts
export { createPlanner, bindRunPlan, computeReachableSteps };
export type { Planner, BindRunPlanOptions };
export { PlannerError };
export type { PlannerErrorCode };
// Re-exported from existing planner:
export type { DiscoverOptions, ProjectContext, PlanProposal,
  ProposedCheck, LocalSignal, LocalSignalType, DetectedLanguage,
  DetectedPackageManager, MonorepoMarker, ChangedFile,
  DiscoveryExplanation };
export { DiscoveryError };
export type { DiscoveryErrorCode };
```

## Data models

**Reachability**: Starting from the Entry's `roots` (Step IDs), compute
the transitive closure by following `dependencies[].producer` edges. Only
reachable Steps are included in the Run Plan. The order preserves the
graph's step order, filtered to reachable steps.

**Input binding**: The pipeline's `inputs` array defines input names and
defaults. User-supplied `inputs` override defaults. Missing required
inputs (no default, no override) cause a `MISSING_INPUT` error. The
bound inputs become `RunPlan.inputs` as a `Record<string, InputValue>`.

**Run Plan construction**:
1. Find the Entry by `entryId` in the graph's pipeline entries.
2. Compute reachable steps from Entry roots.
3. Bind inputs (defaults + overrides).
4. Compute `graphId` via `computeGraphId(graph)`.
5. Compute `runPlanId` via `computeRunPlanId({ apiVersion, graphId, entry, inputs, steps })`.
6. Set `createdAt` to `new Date().toISOString()`.
7. Return the complete `RunPlan`.

**Graph ID**: Computed from the full Definition Graph (not just reachable
steps). This links the Run Plan to its source graph for traceability.

**Run Plan ID**: Computed from the plan body excluding `id` and `createdAt`
(volatile fields). This makes the ID deterministic for the same plan content.

## Error handling

```ts
class PlannerError extends Error {
  override readonly cause: unknown;
  readonly code: PlannerErrorCode;
}

type PlannerErrorCode =
  | "ENTRY_NOT_FOUND"
  | "ROOT_NOT_FOUND"
  | "MISSING_INPUT"
  | "INVALID_GRAPH";
```

`ENTRY_NOT_FOUND`: the specified `entryId` does not exist in the graph.
`ROOT_NOT_FOUND`: an Entry root references a non-existent Step.
`MISSING_INPUT`: a required input has no default and no override.
`INVALID_GRAPH`: the graph has no pipelines or is structurally invalid.

## Test plan

1. `createPlanner`: returns a Planner with discover, plan, bindRunPlan.
2. `bindRunPlan`: single-step graph → RunPlan with that step.
3. `bindRunPlan`: multi-step graph with dependencies → all reachable steps included.
4. `bindRunPlan`: unreachable steps are excluded from the Run Plan.
5. `bindRunPlan`: inputs bound from defaults.
6. `bindRunPlan`: user inputs override defaults.
7. `bindRunPlan`: missing required input → throws PlannerError(MISSING_INPUT).
8. `bindRunPlan`: entry not found → throws PlannerError(ENTRY_NOT_FOUND).
9. `bindRunPlan`: root not found → throws PlannerError(ROOT_NOT_FOUND).
10. `bindRunPlan`: produces deterministic runPlanId for same content.
11. `bindRunPlan`: produces graphId matching computeGraphId.
12. `bindRunPlan`: sets createdAt to ISO string.
13. `computeReachableSteps`: transitive closure from roots.
14. `computeReachableSteps`: empty roots → empty result.
15. `computeReachableSteps`: handles diamond dependencies (no duplicates).
16. `PlannerError`: extends Error with code and cause.
17. Public API: all exports present, no any types.
18. Discovery: existing discover() still works (regression test).
