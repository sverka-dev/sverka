# Spec 01 — CDK

**Status:** Active
**Source:** specs/architecture-spec.md §8, §9.1, §12, §13, §14, §15
**Package:** `@sverka/cdk`

## Overview

The `cdk` package wraps the npm `constructs` library with Sverka-specific
construct types. It provides the construct tree for ownership, identity,
composition, and metadata (§8.2). It also defines the shared model types
(Trigger, Reference, Runtime, Input, Output) used by both the construct tree
and the Definition Graph.

The construct tree is NOT the execution graph (§8.3). It owns authoring
representation; `@sverka/core` owns the Definition Graph and synthesis.

## Goals

- SverkaConstruct base class extending `constructs.Construct` (insulation layer, §8.1)
- Project, Pipeline, Step, ShellStep, Entry construct classes (§9.1, §10)
- Trigger types: Push, ChangeRequest, Manual with filters (§13)
- Reference types: step-output and context references (§11.1, §12.3)
- Runtime, Input, Output model types (§14, §12.1, §12.2)
- Zero `@sverka/*` dependencies — foundation layer

## Non-goals

- Definition Graph types and synthesis (spec 02, 05 — `core` package)
- SDK composables — `sh`, `artifact`, `images`, `pipeline` (spec 03 — `sdk`)
- Decorator API — `@step`, `@entry` (spec 04 — `decorators`)
- `images` typed values (SDK wave C; raw OCI strings suffice for Construct API)
- Method-based steps (decorator wave D)
- Composite / reusable subtrees (deferred §32)
- Plugin-provided context references (plugin wave E)
- Capability analysis (plugin wave E)

## Interfaces

### Construct classes

```ts
import { Construct } from "constructs";

// Insulation layer — Sverka-specific behavior added here as needed.
class SverkaConstruct extends Construct {}

// Root of the construct tree. scope = undefined.
class Project extends SverkaConstruct {
  constructor(id: string);
}

// Contains Steps and Entries.
interface PipelineProps {
  inputs?: Record<string, Input>;
}
class Pipeline extends SverkaConstruct {
  readonly inputs: ReadonlyMap<string, Input>;
  constructor(scope: Project, id: string, props?: PipelineProps);
}

// Abstract base. Holds shared step properties.
interface StepProps {
  runtime?: Runtime;
  outputs?: Record<string, OutputDeclaration>;
  inputs?: Reference[];
  dependsOn?: string[];      // explicit control deps (step names)
  timeout?: number;          // milliseconds
}
abstract class Step extends SverkaConstruct {
  readonly runtime: Runtime;
  readonly outputs: ReadonlyMap<string, OutputDeclaration>;
  readonly inputs: ReadonlyArray<Reference>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly timeout?: number;
  constructor(scope: Pipeline, id: string, props: StepProps);
}

// Concrete shell-command step (§9.1, §15).
interface ShellStepProps extends StepProps {
  command: string;
}
class ShellStep extends Step {
  readonly command: string;
  constructor(scope: Pipeline, id: string, props: ShellStepProps);
}

// Binds a Trigger to root Steps (§13).
interface EntryProps {
  trigger: Trigger;
  roots: string[];           // step names within the same Pipeline
}
class Entry extends SverkaConstruct {
  readonly trigger: Trigger;
  readonly roots: ReadonlyArray<string>;
  constructor(scope: Pipeline, id: string, props: EntryProps);
}
```

### Model types

```ts
// Triggers (§13)
type Trigger = Push | ChangeRequest | Manual;
interface TriggerFilter {
  branches?: string[];
  tags?: string[];
  paths?: string[];
}
interface Push         { kind: "push"; filter?: TriggerFilter }
interface ChangeRequest { kind: "changeRequest"; filter?: TriggerFilter }
interface Manual        { kind: "manual"; filter?: TriggerFilter }
function push(filter?: TriggerFilter): Push;
function changeRequest(filter?: TriggerFilter): ChangeRequest;
function manual(filter?: TriggerFilter): Manual;

// References (§11.1, §12.3)
type Reference = StepRef | ContextRef;
interface StepRef {
  kind: "step";
  step: string;              // producing step name
  output: string;            // output name
  type: OutputType;          // "artifact" → artifact dependency
}
interface ContextRef {
  kind: "context";
  namespace: "env" | "secrets" | "git" | "change" | "event" | "run" | "inputs";
  field: string;
}

// Outputs (§12.2)
type OutputType = "string" | "number" | "boolean" | "artifact";
interface OutputDeclaration {
  type: OutputType;
  path?: string;             // required for artifact outputs
  description?: string;
}

// Inputs (§12.1)
// v0 cut: validation constraint from §12.1 deferred (no validation engine
// in Wave A; plugin wave E may add).
type InputType = "string" | "number" | "boolean";
interface Input {
  type: InputType;
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  secret?: boolean;
}

// Runtime (§14.1)
// v0 cut: architecture and agent-selectors from §14.1 deferred (no consumer
// in Wave A; native engine Wave F will add if needed).
interface Runtime {
  mode?: "host" | "container";
  image?: string;            // OCI reference
  env?: Record<string, string>;
  secrets?: string[];
  workingDir?: string;
}
```

### Exports

All public types and classes exported from `src/index.ts`:

```ts
export { SverkaConstruct, Project, Pipeline, Step, ShellStep, Entry };
export type { PipelineProps, StepProps, ShellStepProps, EntryProps };
export type { Trigger, Push, ChangeRequest, Manual, TriggerFilter };
export { push, changeRequest, manual };
export type { Reference, StepRef, ContextRef };
export type { OutputType, OutputDeclaration, InputType, Input };
export type { Runtime };
export { ConstructError, type ConstructErrorCode };
```

## Data models

Construct identity is the `constructs` path (`node.path`), e.g. `myproj/ci/build`.
Step IDs in the Definition Graph derive from the construct path within the
Pipeline scope.

## Error handling

```ts
type ConstructErrorCode = "INVALID_SCOPE" | "DUPLICATE_ID" | "INVALID_OUTPUT";
class ConstructError extends Error {
  override readonly cause: unknown;
  readonly code: ConstructErrorCode;
}
```

`INVALID_SCOPE` — wrong parent type (e.g. Step under Project instead of Pipeline).
`DUPLICATE_ID` — two children with the same name in the same scope.
`INVALID_OUTPUT` — artifact output missing `path`.

## Test plan

1. Project creates root construct; `node.path === id`.
2. Pipeline under Project; path = `project/pipeline`.
3. ShellStep under Pipeline; holds command, runtime, outputs, inputs, dependsOn.
4. Entry under Pipeline; holds trigger and roots.
5. Trigger factories: `push()`, `changeRequest()`, `manual()` with filters.
6. StepRef and ContextRef construct with correct shape.
7. Input/Output/Runtime types construct correctly.
8. Construct tree traversal: `project.node.children` returns Pipelines;
   `pipeline.node.children` returns Steps and Entries.
9. Duplicate child id throws `ConstructError(DUPLICATE_ID)`.
10. Step under Project (wrong scope) throws `ConstructError(INVALID_SCOPE)`.
11. Artifact output without path throws `ConstructError(INVALID_OUTPUT)`.
