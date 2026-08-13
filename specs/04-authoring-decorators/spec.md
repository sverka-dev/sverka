# Spec 04 — Authoring decorators

**Status:** Active
**Source:** specs/architecture-spec.md §9.3–9.8, §12, §14, §15
**Package:** `@sverka/decorators` (new)

## Overview

The Decorator API is the third authoring surface (after Construct API and
SDK). It uses TC39 standard ECMAScript decorators (TypeScript 5.0+,
no `experimentalDecorators`). Decorated classes produce the same
Definition Graph as the Construct and SDK APIs.

## Goals

- `@pipeline` — class decorator that creates a Pipeline under a Project
- `@step` — field decorator for string shorthand (leaf step)
- `@step(options)` — field decorator with runtime/timeout/outputs options
- `@step` — method decorator for planning methods (multiple sh operations)
- `@entry(trigger)` — field decorator for entry definitions
- `@input` — field decorator for pipeline inputs
- `@output` — field decorator for pipeline outputs
- Decorated pipeline synthesizes the same Definition Graph as Construct/SDK
- No `experimentalDecorators`, no `reflect-metadata`
- Sverka metadata stored via explicit registries/symbols

## Non-goals

- Stacked namespace decorators (`@step.image(...)`, `@step.timeout(...)`)
- `@step.native` (requires asset bundling — future)
- Forward references (must use SDK/Construct API for those)
- Private fields and symbol-named members
- Mixing decorator-authored steps with SDK composables in the same
  pipeline class (supported by architecture but not required for v0)

## Interfaces

```ts
// Class decorator — marks a class as a Sverka pipeline
@pipeline
class MyPipeline {
  @input
  nodeVersion: Input = { type: "string", default: "22" };

  @step
  lint = "npm run lint";

  @step({ timeout: 600000 })
  build = sh`npm run build`.outputs({ dist: artifact("./dist") });

  @step
  deploy = sh`deploy ${this.build.dist}`;

  @entry({ kind: "push" })
  onPush = ["lint", "build", "deploy"];
}

// Synthesize
const project = new Project("myproj");
const pipeline = decoratePipeline(MyPipeline, project, "ci");
const graph = synthesize(project);
```

### Exports

```ts
export { pipeline, step, entry, input, output };
export { decoratePipeline } from "./registry.js";
export type { StepOptions, EntryTarget } from "./types.js";
export { DecoratorError, type DecoratorErrorCode } from "./errors.js";
```

## Data models

### Decorator metadata

Decorators store metadata via a `Symbol` key on the class prototype:
`Symbol.for("sverka:fields")` — a map of field name → field metadata.

```ts
interface FieldMetadata {
  kind: "step" | "entry" | "input" | "output";
  options?: StepOptions;
  trigger?: Trigger;
}
```

### StepOptions

```ts
interface StepOptions {
  runtime?: Runtime;
  timeout?: number;
  outputs?: Readonly<Record<string, OutputDeclaration>>;
  dependsOn?: readonly string[];
}
```

### Step field values

A `@step` field initializer can be:
- `string` — leaf step with a shell command
- `StepBuilder` (from `sh` tagged template) — composable step with outputs
- `undefined` (method decorator) — planning method with operations

### Entry field values

An `@entry` field initializer is `readonly string[]` — the root step IDs.

### Input field values

An `@input` field initializer is an `Input` object.

### decoratePipeline

`decoratePipeline(PipelineClass, project, id)` creates a `Pipeline`
construct under the `Project`, then iterates the class's field metadata
in source order, creating `ShellStep` and `Entry` constructs for each
decorated field. Field initializers are evaluated to get the step
command, outputs, and dependencies.

## Error handling

Custom error class `DecoratorError` with codes:
- `INVALID_FIELD`: decorated field has an invalid value type
- `MISSING_INITIALIZER`: `@step` field has no initializer
- `INVALID_OPTIONS`: `@step(options)` has invalid options
- `DUPLICATE_FIELD`: duplicate field name in metadata
- `NOT_A_PIPELINE`: `decoratePipeline` called on a non-decorated class

```ts
class DecoratorError extends Error {
  readonly code: DecoratorErrorCode;
  override readonly cause: unknown;
}
```

## Test plan

1. `@step` string shorthand → ShellStep with command
2. `@step(options)` with timeout → ShellStep with timeout
3. `@step` with `sh` builder → ShellStep with outputs and inputs
4. `@step` method → ShellStep with joined commands
5. `@entry(trigger)` → Entry with trigger and roots
6. `@input` → Pipeline input registered
7. Multiple steps in source order → correct construct tree
8. `decoratePipeline` → Pipeline with correct id and children
9. Synthesized graph matches Construct API equivalent
10. Error: `@step` without initializer → INVALID_FIELD
11. Error: `decoratePipeline` on non-decorated class → NOT_A_PIPELINE
12. Public API: all exports present, no any types
13. Conformance: decorator-authored pipeline produces same graph as
    equivalent Construct API pipeline
