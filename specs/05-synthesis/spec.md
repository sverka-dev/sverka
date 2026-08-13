# Spec 05 — Synthesis

**Status:** Active
**Source:** specs/architecture-spec.md §16, §11.3, §11.4
**Package:** `@sverka/core`

## Overview

Synthesis transforms a construct tree (`@sverka/cdk`) into a Definition
Graph (§16). The lifecycle phases in scope for v0 Wave A:

```text
discover → instantiate → normalize → build graph → validate
```

Discover and instantiate are implicit — the user creates the construct tree
directly. Synthesis traverses it, normalizes Steps into StepDefinitions, infers
dependencies from References (§11.3), and validates (§11.4).

Capability analysis, target lowering, and Run Plan building are later waves.

## Goals

- `synthesize(project: Project): DefinitionGraph` — the single entry point
- Normalize ShellStep → StepDefinition with operations (shell, export, import)
- Infer dependencies: value from scalar StepRef, artifact from artifact
  StepRef, control from explicit `dependsOn` (§11.3)
- Validate: cycles, unknown producers, output collisions, incompatible
  reference types (§11.4)
- Deterministic: same construct tree → same Definition Graph (§5.5)

## Non-goals

- Capability analysis (plugin wave E)
- Target lowering (target waves H, I)
- Run Plan building (planner wave G)
- Serialization / canonical form (IR wave B)
- Trigger reachability validation (needs Run Plan — wave G)
- Context reference availability validation (needs capability model — wave E)
- Method-based step planning (decorator wave D)
- SDK composable synthesis (SDK wave C — but SDK produces same construct tree,
  so same synthesis applies)

## Interfaces

```ts
import type { Project } from "@sverka/cdk";
import type { DefinitionGraph } from "./graph.js";

function synthesize(project: Project): DefinitionGraph;
```

### Errors

```ts
type SynthesisErrorCode =
  | "CYCLE"
  | "UNKNOWN_PRODUCER"
  | "OUTPUT_COLLISION"
  | "INCOMPATIBLE_REFERENCE"
  | "INVALID_OUTPUT"
  | "INVALID_SCOPE";

class SynthesisError extends Error {
  override readonly cause: unknown;
  readonly code: SynthesisErrorCode;
  readonly stepId?: string;
}
```

## Data models

### Operation normalization

A ShellStep with `command: "npm run build"` and `outputs: { dist: { type:
"artifact", path: "./dist" } }` normalizes to:

```text
operations: [
  { kind: "shell", command: "npm run build" },
  { kind: "exportArtifact", name: "dist", path: "./dist" }
]
```

A scalar output `{ version: { type: "string" } }` normalizes to
`{ kind: "exportOutput", name: "version", type: "string" }`.

An artifact input (StepRef with `type: "artifact"`) normalizes to
`{ kind: "importArtifact", name: <output>, from: <producerId>, output: <output> }`
where `<producerId>` is the fully qualified step id (e.g. `ci/build`).

### Dependency inference

| Source | Dependency kind |
|---|---|
| `StepRef` with `type: "artifact"` | `artifact` |
| `StepRef` with scalar `type` | `value` |
| `dependsOn: ["build"]` | `control` |

Inferred dependencies are deduplicated. If a Step both references a producer's
output and explicitly depends on it, the value/artifact dependency is kept
(more specific).

### Validation

| Code | Condition |
|---|---|
| `CYCLE` | Dependency graph has a cycle (DFS detection) |
| `UNKNOWN_PRODUCER` | StepRef or `dependsOn` references a step that doesn't exist in the Pipeline |
| `OUTPUT_COLLISION` | Two outputs in a Step have the same name |
| `INCOMPATIBLE_REFERENCE` | StepRef type doesn't match the producer's output type |
| `INVALID_OUTPUT` | An artifact output is missing `path` |
| `INVALID_SCOPE` | A Project or Pipeline contains an unexpected construct type |

Validation runs after graph construction. First error thrown stops synthesis.

## Error handling

`SynthesisError` thrown on first validation failure. `stepId` identifies the
Step where the error was detected. `cause` carries underlying detail when
applicable.

## Test plan

1. `synthesize(Project)` with empty Pipeline → DefinitionGraph with empty
   steps/entries arrays.
2. `synthesize` with ShellStep → StepDefinition with shell operation.
3. `synthesize` with scalar output → exportOutput operation.
4. `synthesize` with artifact output → exportArtifact operation.
5. `synthesize` with artifact StepRef in inputs → importArtifact operation +
   artifact dependency.
6. `synthesize` with scalar StepRef in inputs → value dependency.
7. `synthesize` with `dependsOn` → control dependency.
8. `synthesize` deduplicates: same producer referenced twice → one dependency.
9. `synthesize` detects cycle → `SynthesisError(CYCLE)`.
10. `synthesize` detects unknown producer → `SynthesisError(UNKNOWN_PRODUCER)`.
11. `synthesize` detects output collision → `SynthesisError(OUTPUT_COLLISION)`.
12. `synthesize` detects incompatible reference type →
    `SynthesisError(INCOMPATIBLE_REFERENCE)`.
13. **Conformance seed:** a representative Pipeline (build → test → deploy with
    artifact + scalar output transfer) synthesizes a canonical Definition Graph.
    The graph structure is asserted by the test. This seed is the foundation
    for the §33.1 authoring conformance suite (Waves C, D will assert SDK and
    Decorator APIs produce the same graph).
14. Determinism: same construct tree synthesized twice → identical Definition
    Graph (deep equality).
