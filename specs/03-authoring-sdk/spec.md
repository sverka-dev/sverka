# Spec 03 — Authoring SDK

**Status:** Active
**Source:** specs/architecture-spec.md §9.2, §12, §14, §15
**Package:** `@sverka/sdk` (rebuilt)

## Overview

The SDK is a convenience layer over the Construct API (§9.2). SDK helpers
create the same construct types (`Project`, `Pipeline`, `ShellStep`, `Entry`)
with a more ergonomic, composable API. The synthesized Definition Graph is
identical regardless of which authoring surface is used.

## Goals

- `sh` tagged template — creates a shell command step builder
- `artifact` — creates an artifact output declaration
- `pipeline` — creates a pipeline with steps and entries
- `when` — creates a condition reference for step gating
- Context namespaces: `env`, `secrets`, `git`, `change`, `event`, `run`,
  `inputs` (§12.3)
- `images` — typed image value helpers (§14.2)
- Conformance: SDK-authored pipeline synthesizes same graph as Construct API

## Non-goals

- `matrix` — deferred from v0 (§32)
- `parallel` — not a separate construct; users create multiple steps
- Decorator API (Wave D, spec 04)
- Runtime execution (Wave F)
- Target lowering (Wave H/I)
- `defineWorkflow` / `task` / `run` from old SDK — those were the flat Plan
  API, replaced by construct tree + synthesis

## Interfaces

```ts
import type {
  Runtime, Input, OutputDeclaration, Reference, Trigger,
} from "@sverka/constructs";
import type { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";

// --- sh: shell command step builder ---

interface StepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder;
  inputs(inputs: readonly Reference[]): StepBuilder;
  dependsOn(steps: readonly string[]): StepBuilder;
  runtime(runtime: Runtime): StepBuilder;
  timeout(ms: number): StepBuilder;
  /** Build a ShellStep under the given pipeline. */
  build(pipeline: Pipeline, id: string): ShellStep;
}

function sh(strings: TemplateStringsArray, ...values: readonly (string | Reference)[]): StepBuilder;

// --- artifact: output declaration factory ---

function artifact(path: string): OutputDeclaration;

// --- pipeline: pipeline factory ---

interface PipelineConfig {
  inputs?: Readonly<Record<string, Input>>;
  steps?: ReadonlyArray<(pipeline: Pipeline) => void>;
  entries?: ReadonlyArray<(pipeline: Pipeline) => Entry>;
}

function pipeline(project: Project, id: string, config: PipelineConfig): Pipeline;

// --- when: condition reference ---

function when(ref: Reference): Reference;

// --- images: typed image values (§14.2) ---

interface ImageRef {
  readonly ref: string;  // raw OCI reference
}

const images: {
  node: { readonly latest: ImageRef; readonly [version: number]: ImageRef };
  ubuntu: { readonly latest: ImageRef };
};

function image(ref: string): ImageRef;

// --- context namespaces (§12.3) ---

const env: Record<string, ContextRef>;
const secrets: Record<string, ContextRef>;
const git: { sha: ContextRef; branch: ContextRef; tag: ContextRef };
const change: { id: ContextRef; source: ContextRef; target: ContextRef; draft: ContextRef };
const event: { type: ContextRef };
const run: { id: ContextRef; attempt: ContextRef };
const inputs: Record<string, ContextRef>;
```

### Exports

```ts
export { sh, artifact, pipeline, when, image, images };
export { env, secrets, git, change, event, run, inputs };
export type { StepBuilder, PipelineConfig, ImageRef };
```

## Data models

**`sh` template**: interpolates `Reference` values by their step id + output
name. String values are inserted literally. The resulting command string is
passed to `ShellStep`. References used in interpolation are also added to the
step's `inputs` array (the builder collects them).

**`StepBuilder`**: a mutable builder that accumulates outputs, inputs,
dependsOn, runtime, and timeout. `build()` creates a `ShellStep` under the
given pipeline.

**`pipeline` factory**: creates a `Pipeline`, then calls each step function
passing the pipeline, then calls each entry function. Step functions create
`ShellStep` instances; entry functions create `Entry` instances.

**Context namespaces**: `ContextRef` objects with `kind: "context"`, the
namespace, and the field name. `env.CI_TRACE` → `{ kind: "context",
namespace: "env", field: "CI_TRACE" }`. Dynamic fields (`env["MY_VAR"]`)
use bracket notation.

**`images`**: returns `ImageRef` objects. `images.node[22]` →
`{ ref: "node:22" }`. `images.ubuntu.latest` → `{ ref: "ubuntu:latest" }`.
Used in `runtime: { image: images.node[22].ref }`.

## Error handling

```ts
class SdkError extends Error {
  override readonly cause: unknown;
  readonly code: SdkErrorCode;
}

type SdkErrorCode = "INVALID_INTERPOLATION" | "INVALID_IMAGE";
```

`INVALID_INTERPOLATION`: non-string, non-Reference value used in `sh` template.
`INVALID_IMAGE`: invalid image reference string.

## Test plan

1. `sh` template: creates a StepBuilder with the command string.
2. `sh` with Reference interpolation: command includes the reference text,
   reference added to inputs.
3. `sh` with string interpolation: command includes the string literally.
4. `StepBuilder.outputs()`: adds output declarations.
5. `StepBuilder.build()`: creates a ShellStep under the pipeline with all
   accumulated properties.
6. `artifact("./dist")`: returns `{ type: "artifact", path: "./dist" }`.
7. `pipeline()` factory: creates Pipeline, runs step functions, runs entry
   functions.
8. `when(ref)`: returns the reference unchanged (identity — conditions are
   references in v0).
9. `images.node[22]`: returns `{ ref: "node:22" }`.
10. `images.ubuntu.latest`: returns `{ ref: "ubuntu:latest" }`.
11. `image("ghcr.io/acme/build:2026")`: returns `{ ref: "ghcr.io/acme/build:2026" }`.
12. `env.CI_TRACE`: returns `{ kind: "context", namespace: "env", field: "CI_TRACE" }`.
13. `git.sha`: returns `{ kind: "context", namespace: "git", field: "sha" }`.
14. `inputs.environment`: returns `{ kind: "context", namespace: "inputs", field: "environment" }`.
15. Conformance: SDK-authored build→test→deploy pipeline synthesizes the
    same Definition Graph as the Construct API conformance seed.
16. Error classes: `SdkError` base, `override readonly cause`.
17. Public API: all exports present, no `any` types.
