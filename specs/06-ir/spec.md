# Spec 06 — IR: Definition Graph + Run Plan Schemas

**Status:** Active
**Source:** specs/architecture-spec.md §10, §16, §22; ADR-003 (amended), ADR-006 (amended)
**Package:** `@sverka/ir` (rebuilt)

## Overview

The IR package owns the serializable wire format for the Definition Graph and
the Run Plan (ADR-003 amended). The Definition Graph types live in
`@sverka/core` (spec 02); IR wraps them with versioning, canonical
serialization, deterministic IDs, and schema validation. The Run Plan schema
is defined here — it is the self-contained executable form consumed by the
native engine (§22).

## Goals

- Serializable Definition Graph envelope: `sverka.dev/v1graph` (§10)
- Run Plan schema: `sverka.dev/v1run` — bound entry + inputs + reachable
  steps (§22.1 component 1, §16)
- Canonical JSON serialization (sorted keys, compact, deterministic)
- Deterministic content-addressed IDs: `graph-<sha256>`, `rp-<sha256>`
- Schema validation on deserialization (structural + delegates to core for
  semantic validation)
- Fix Wave A OUTPUT_COLLISION validator test gap (review finding)

## Non-goals

- Run Plan binding logic (planner, Wave G — §22.1 component 1)
- Run Plan execution (engine, Wave F — §22)
- Target lowering (Wave H/I)
- `computeOperationId` — operations are nested in steps, identified by
  `(stepId, index)`. No hash-based operation IDs in the graph model.
- `PlanValidator`/`ValidationResult` interfaces — use throw-on-error
  validation (consistent with `@sverka/core`)
- `deepFreeze` — readonly TypeScript types enforce immutability at compile
  time; runtime freezing is unnecessary for v0

## Interfaces

```ts
import type { DefinitionGraph, StepDefinition } from "@sverka/core";
import type { Trigger } from "@sverka/cdk";

// --- Serializable Definition Graph ---

interface SerializableGraph {
  apiVersion: "sverka.dev/v1graph";
  id: string;                    // graph-<64hex>, content-addressed
  graph: DefinitionGraph;
  createdAt: string;             // ISO 8601, informational
}

// --- Run Plan ---

interface RunPlan {
  apiVersion: "sverka.dev/v1run";
  id: string;                    // rp-<64hex>, content-addressed
  graphId: string;               // source Definition Graph id
  entry: BoundEntry;
  inputs: Readonly<Record<string, InputValue>>;
  steps: readonly StepDefinition[];  // reachable from entry roots
  createdAt: string;             // ISO 8601, informational
}

interface BoundEntry {
  id: string;                    // EntryDefinition id
  trigger: Trigger;
}

type InputValue = string | number | boolean;
```

### Functions

```ts
// Serialization
function serializeGraph(graph: DefinitionGraph): string;
function deserializeGraph(json: string): SerializableGraph;
function serializeRunPlan(plan: RunPlan): string;
function deserializeRunPlan(json: string): RunPlan;

// IDs
function computeGraphId(graph: DefinitionGraph): string;
function computeRunPlanId(plan: Omit<RunPlan, "id" | "createdAt">): string;

// Validation (throw-on-error)
function validateGraphSchema(value: unknown): asserts value is SerializableGraph;
function validateRunPlanSchema(value: unknown): asserts value is RunPlan;
```

### Exports

```ts
export type { SerializableGraph, RunPlan, BoundEntry, InputValue };
export {
  serializeGraph, deserializeGraph,
  serializeRunPlan, deserializeRunPlan,
  computeGraphId, computeRunPlanId,
  validateGraphSchema, validateRunPlanSchema,
  IRError, ValidationError, SerializationError,
  GRAPH_SCHEMA_VERSION, RUN_PLAN_SCHEMA_VERSION,
};
```

## Data models

**Canonical JSON** (internal `canonicalStringify`): sorted keys (UTF-16
code-unit order), compact (no whitespace), `undefined` omitted from objects,
`undefined` array elements emit `null`, `NaN`/`Infinity` rejected, `Date`
emits ISO string. Manual recursive emitter — single source of truth for both
serialization and ID computation. Lives in IR (not core) because only IR
needs it.

**Graph ID**: SHA-256 over `canonicalStringify(graph)` (the DefinitionGraph
without envelope), hex-encoded, prefixed `graph-`.

**Run Plan ID**: SHA-256 over `canonicalStringify(plan)` with `id` and
`createdAt` stripped, hex-encoded, prefixed `rp-`.

**Schema versions**: `GRAPH_SCHEMA_VERSION = "sverka.dev/v1graph"`,
`RUN_PLAN_SCHEMA_VERSION = "sverka.dev/v1run"`.

## Error handling

```ts
class IRError extends Error {
  override readonly cause: unknown;
  readonly code: IRErrorCode;
}

type IRErrorCode = "VALIDATION_ERROR" | "SERIALIZATION_ERROR";

class ValidationError extends IRError { code: "VALIDATION_ERROR" }
class SerializationError extends IRError { code: "SERIALIZATION_ERROR" }
```

`ValidationError`: schema or semantic validation failure on deserialization.
`SerializationError`: JSON parse failure or canonical serialization failure
(NaN/Infinity). Both use `override readonly cause` per `noImplicitOverride`.

## Core changes (minor)

1. Export `validateGraph(graph: DefinitionGraph): void` from `@sverka/core`
   — runs all 4 validators (detectCycles, validateReferences,
   validateOutputCollisions, validateReferenceTypes). Throws
   `SynthesisError` on failure. IR calls this after schema validation.
2. Fix OUTPUT_COLLISION validator test gap (Wave A review finding): the
   validator checks operations for duplicate export names but the test never
   triggers it. Add a test that synthesizes a step with duplicate export
   names and asserts `SynthesisError(OUTPUT_COLLISION)`.

## Test plan

1. `canonicalStringify`: sorted keys, undefined omitted, arrays preserved,
   NaN rejected, Date → ISO string. (Match ADR-006 test vectors.)
2. `computeGraphId`: deterministic (same graph → same id), prefix `graph-`,
   64 hex chars. Different graphs → different ids.
3. `computeRunPlanId`: deterministic, prefix `rp-`, 64 hex chars. `id` and
   `createdAt` excluded from hash.
4. `serializeGraph` → `deserializeGraph` round-trip: graph preserved,
   apiVersion correct, id matches recomputed value.
5. `deserializeGraph`: rejects malformed JSON (SerializationError), wrong
   apiVersion (ValidationError), missing required fields (ValidationError),
   invalid graph structure (ValidationError). Calls core `validateGraph`
   for semantic checks (cycles, unknown producers).
6. `serializeRunPlan` → `deserializeRunPlan` round-trip: plan preserved,
   apiVersion correct, id matches recomputed value.
7. `deserializeRunPlan`: rejects malformed JSON, wrong apiVersion, missing
   fields, invalid step structure.
8. Run Plan schema: `BoundEntry` has id + trigger, `inputs` is a flat
   record, `steps` is an array of `StepDefinition`.
9. Schema version constants exported and match apiVersion values.
10. Core `validateGraph` exported and runs all 4 validators. OUTPUT_COLLISION
    test gap fixed: duplicate export names → SynthesisError.
11. Error classes: `IRError` base, `ValidationError` and `SerializationError`
    subclasses, `override readonly cause`.
12. Public API: all exports present, no `any` types.
