# Wave B Implementation Plan — IR: Definition Graph + Run Plan Schemas

**Spec:** 06-ir
**Package:** `@sverka/ir` (rebuilt), `@sverka/core` (minor changes)
**Date:** 2026-08-13

## Package dependency

```
@sverka/ir     →  @sverka/core  (DefinitionGraph types + validateGraph)
@sverka/core   →  @sverka/cdk  (unchanged from Wave A)
```

No new external dependencies. Uses `node:crypto` (built-in).

## Reuse vs. rebuild

| Old IR file | Action | Reason |
|---|---|---|
| `internal/canonical.ts` | **Reuse pattern, move to IR** | `canonicalStringify` was in old core; new core deleted it. IR owns it now. |
| `serialize.ts` | **Rebuild** | Old serialized flat `Plan`; new serializes `DefinitionGraph` + `RunPlan` |
| `ids.ts` | **Rebuild** | `computePlanId` → `computeGraphId` + `computeRunPlanId`. No `computeOperationId`. |
| `validate.ts` | **Rebuild** | Old validated flat Plan (459 lines); new validates graph + run plan schemas (~80 lines) |
| `errors.ts` | **Adapt** | Same 3 classes, add `override readonly cause` |
| `plan.ts` | **Delete** | Flat Plan replaced by Run Plan |
| `version.ts` | **Adapt** | `PLAN_SCHEMA_VERSION` → `GRAPH_SCHEMA_VERSION` + `RUN_PLAN_SCHEMA_VERSION` |
| `internal/graph.ts` | **Delete** | `findCycle` replaced by core's `detectCycles` |
| All old tests | **Delete** | Test flat Plan schema; new tests for graph + run plan |

## Core changes (minor)

1. Add `validateGraph(graph: DefinitionGraph): void` to `core/src/validate.ts`
   — iterates pipelines, runs all 4 validators per pipeline. Export from
   `core/src/index.ts`.
2. Fix OUTPUT_COLLISION test gap: add test in `core/src/__tests__/validate.test.ts`
   that creates a step with duplicate `exportOutput` names and asserts
   `SynthesisError(OUTPUT_COLLISION)`.

## File layout

### `packages/ir/`

```
src/
  index.ts          # public exports + schema version constants
  canonical.ts      # canonicalStringify (internal, not exported)
  run-plan.ts       # RunPlan, BoundEntry, InputValue types
  serialize.ts      # serializeGraph, deserializeGraph, serializeRunPlan, deserializeRunPlan
  validate.ts       # validateGraphSchema, validateRunPlanSchema
  ids.ts            # computeGraphId, computeRunPlanId
  errors.ts         # IRError, ValidationError, SerializationError
  __tests__/
    canonical.test.ts       # tests 1
    ids.test.ts             # tests 2-3
    serialize.test.ts       # tests 4-7
    run-plan.test.ts        # test 8
    errors.test.ts          # test 11
    public-api.test.ts      # test 12
    helpers/fixtures.ts     # shared test fixtures (sample graph, run plan)
```

### `packages/core/` (modified)

```
src/
  validate.ts       # + validateGraph() function
  index.ts          # + export validateGraph
  __tests__/
    validate.test.ts  # + OUTPUT_COLLISION test
```

## TDD steps

### Step 1: Core changes — export validateGraph + fix test gap

Write failing test:
- `validate.test.ts`: test that `validateGraph` runs all 4 validators on a
  valid graph (no throw). Test that duplicate export names throw
  `SynthesisError(OUTPUT_COLLISION)`.

Implement:
- `validate.ts`: add `validateGraph(graph: DefinitionGraph): void` — iterate
  pipelines, call each validator.
- `index.ts`: export `validateGraph`.

Verify: `bun run test --filter @sverka/core`, `bun run typecheck --filter @sverka/core`.

### Step 2: Scaffold IR package

Delete old IR source files. Create:
- `package.json` (already exists, update deps: `@sverka/core: "workspace:*"`)
- `src/index.ts` (empty exports)
- `src/errors.ts` (IRError, ValidationError, SerializationError with override cause)
- `src/canonical.ts` (stub)

Verify: `bun run typecheck --filter @sverka/ir` (should pass with stubs).

### Step 3: Canonical JSON

Write failing tests (`canonical.test.ts`):
- ADR-006 test vectors: `{b:1,a:2}` → `{"a":2,"b":1}`, undefined omitted,
  arrays preserved, NaN rejected, Date → ISO string.

Implement `canonicalStringify` in `canonical.ts`:
- Manual recursive emitter (copy pattern from old core, adapt).
- Reject NaN/Infinity by throwing.

Verify: `bun run test --filter @sverka/ir`.

### Step 4: Error classes

Write failing tests (`errors.test.ts`):
- `IRError` is `instanceof Error`, has `code` field.
- `ValidationError` extends `IRError`, code `VALIDATION_ERROR`.
- `SerializationError` extends `IRError`, code `SERIALIZATION_ERROR`.
- Both have `override readonly cause`.

Implement `errors.ts`.

Verify: `bun run test --filter @sverka/ir`.

### Step 5: Run Plan types

Write failing tests (`run-plan.test.ts`):
- `RunPlan` has apiVersion, id, graphId, entry, inputs, steps, createdAt.
- `BoundEntry` has id + trigger.
- `InputValue` is string | number | boolean.

Implement `run-plan.ts` (type definitions only).

Verify: `bun run typecheck --filter @sverka/ir`.

### Step 6: ID computation

Write failing tests (`ids.test.ts`):
- `computeGraphId`: deterministic, `graph-` prefix, 64 hex chars.
- `computeRunPlanId`: deterministic, `rp-` prefix, 64 hex chars.
- `id`/`createdAt` excluded from run plan hash.

Implement `ids.ts`:
- `computeGraphId(graph)`: SHA-256 over `canonicalStringify(graph)`.
- `computeRunPlanId(plan)`: strip id/createdAt, SHA-256 over canonical.

Verify: `bun run test --filter @sverka/ir`.

### Step 7: Serialization

Write failing tests (`serialize.test.ts`):
- `serializeGraph` → `deserializeGraph` round-trip.
- `deserializeGraph`: rejects malformed JSON, wrong apiVersion, missing
  fields, invalid structure. Calls core `validateGraph`.
- `serializeRunPlan` → `deserializeRunPlan` round-trip.
- `deserializeRunPlan`: rejects malformed JSON, wrong apiVersion, missing
  fields.

Implement `serialize.ts`:
- `serializeGraph(graph)`: build `SerializableGraph` envelope (apiVersion,
  id=computeGraphId, graph, createdAt), canonicalStringify.
- `deserializeGraph(json)`: JSON.parse, validateGraphSchema, return.
- `serializeRunPlan(plan)`: canonicalStringify.
- `deserializeRunPlan(json)`: JSON.parse, validateRunPlanSchema, return.

Implement `validate.ts`:
- `validateGraphSchema(value)`: assert shape (apiVersion, id, graph,
  createdAt), assert graph structure (project → pipelines → steps...),
  call core `validateGraph`.
- `validateRunPlanSchema(value)`: assert shape (apiVersion, id, graphId,
  entry, inputs, steps, createdAt), validate step structure.

Verify: `bun run test --filter @sverka/ir`.

### Step 8: Public API + version constants

Write failing tests (`public-api.test.ts`):
- All exports present (types + functions + error classes + version constants).
- `GRAPH_SCHEMA_VERSION === "sverka.dev/v1graph"`.
- `RUN_PLAN_SCHEMA_VERSION === "sverka.dev/v1run"`.
- No `any` types in public API.

Implement `index.ts`:
- Export all types, functions, error classes, version constants.

Verify: `bun run test --filter @sverka/ir`, `bun run typecheck --filter @sverka/ir`,
`bun run lint --filter @sverka/ir`, `bun run build --filter @sverka/ir`.

### Step 9: Full gates

Run all four gates on IR + core:
```
bun run test --filter @sverka/ir --filter @sverka/core
bun run typecheck --filter @sverka/ir --filter @sverka/core
bun run lint --filter @sverka/ir --filter @sverka/core
bun run build --filter @sverka/ir --filter @sverka/core
```

Full monorepo test expected to fail (old ir dependents — sdk, cli, etc. —
reference the old flat Plan types). Only IR + core gates must pass. This is
the same pattern as Wave A.

### Step 10: ADR amendments

Amend ADR-006:
- `canonicalStringify` now lives in `@sverka/ir`, not `@sverka/core`.
- `computeOperationId` removed — operations are nested in steps.
- ID scheme: `graph-<sha256>` and `rp-<sha256>` replace `plan-<sha256>`.

Amend ADR-003: already amended by v0 redesign (ADR-009). Confirm the
amendment text is accurate (Definition Graph + Run Plan).

## Conformance

No new conformance seed. Wave B is infrastructure (serialization). The
conformance seed from Wave A (build→test→deploy) should now be serializable:
`serializeGraph(synthesize(project))` produces a valid `sverka.dev/v1graph`
JSON string, and `deserializeGraph` round-trips it.
