# Spec 02 — Definition Graph

**Status:** Active
**Source:** specs/architecture-spec.md §10, §11, §15
**Package:** `@sverka/core`

## Overview

The Definition Graph is the canonical provider-neutral source of truth produced
by synthesis (§10). It is a plain data structure — no behavior, no construct
tree ownership. It describes Steps, their Operations, typed References, and
dependency edges.

The Definition Graph is separate from the construct tree (§5.3, §8.3): the
construct tree owns ownership and composition; the Definition Graph owns
scheduling, dependencies, and data transfer.

## Goals

- Definition Graph types: ProjectDefinition, PipelineDefinition, EntryDefinition,
  StepDefinition, OperationDefinition (§10)
- Dependency type: control, value, artifact (§11.2)
- Operation types: shell, exportOutput, exportArtifact, importArtifact,
  diagnostic (§15)
- Reuse model types from `@sverka/cdk` (Reference, Trigger, Runtime,
  Input, OutputDeclaration)

## Non-goals

- Synthesis logic (spec 05)
- Run Plan schema (spec 06 — `ir` package, wave B)
- Serialization / canonical form (spec 06 — `ir` package, wave B)
- Validation logic (spec 05)
- Capability analysis (plugin wave E)
- ExtensionNode in PipelineDefinition (plugin wave E)

## Interfaces

```ts
import type {
  Reference, Trigger, Runtime, Input, OutputDeclaration, OutputType,
} from "@sverka/cdk";

interface DefinitionGraph {
  project: ProjectDefinition;
}

interface ProjectDefinition {
  id: string;
  pipelines: PipelineDefinition[];
}

interface OutputDefinition extends OutputDeclaration {
  name: string;
}

interface PipelineOutputDefinition extends OutputDefinition {
  stepId: string;
}

interface PipelineDefinition {
  id: string;
  inputs: Input[];
  entries: EntryDefinition[];
  steps: StepDefinition[];
  outputs: PipelineOutputDefinition[];
}

interface EntryDefinition {
  id: string;
  trigger: Trigger;
  roots: string[];             // StepDefinition ids
}

interface StepDefinition {
  id: string;
  runtime: Runtime;
  operations: OperationDefinition[];
  inputs: Reference[];
  outputs: OutputDefinition[];
  dependencies: Dependency[];
  timeout?: number;            // milliseconds
  // §10 specifies Expression<boolean>; v0 narrows to a boolean-producing
  // Reference. Full expression DSL deferred (no consumer in Wave A).
  condition?: Reference;
}

type OperationDefinition =
  | { kind: "shell"; command: string }
  | { kind: "exportOutput"; name: string; type: OutputType }
  | { kind: "exportArtifact"; name: string; path: string }
  | { kind: "importArtifact"; name: string; from: string; output: string }
  | { kind: "diagnostic"; message: string; severity: "info" | "warn" | "error" };

// §15 "shell command sequence" is represented as multiple ordered {kind:"shell"}
// operations in the operations array. No separate sequence variant needed.

type Dependency =
  | { kind: "control"; producer: string }
  | { kind: "value"; producer: string; output: string }
  | { kind: "artifact"; producer: string; output: string };
```

### Exports

```ts
export type {
  DefinitionGraph, ProjectDefinition, PipelineDefinition,
  EntryDefinition, StepDefinition, OperationDefinition, Dependency,
  OutputDefinition, PipelineOutputDefinition,
};
```

## Data models

Step IDs are construct paths relative to the Project root (e.g. `ci/build`).
Pipeline IDs are construct paths relative to the Project root (e.g. `ci`).

Dependencies are stored from the consumer's perspective: a StepDefinition's
`dependencies` array lists the producers it depends on.

## Error handling

No errors thrown by this package — it defines types only. Validation errors
are in `@sverka/core` synthesis (spec 05).

## Test plan

1. DefinitionGraph structure: Project → Pipelines → Steps/Entries.
2. StepDefinition holds operations, inputs, outputs, dependencies, runtime.
3. OperationDefinition variants: shell, exportOutput, exportArtifact,
   importArtifact, diagnostic — each with correct fields.
4. Dependency variants: control (no output), value (output + scalar type),
   artifact (output + artifact type).
5. EntryDefinition holds trigger and root step ids.
6. StepDefinition with optional timeout and condition.
7. PipelineDefinition with inputs and outputs.
