# Wave A Implementation Plan — Constructs + Definition Graph

**Specs:** 01-constructs, 02-definition-graph, 05-synthesis
**Packages:** `@sverka/constructs` (new), `@sverka/core` (rebuilt)
**Date:** 2026-08-13

## Package dependency

```
@sverka/constructs  →  constructs@10.8.1 (npm)
@sverka/core        →  @sverka/constructs
```

No other `@sverka/*` deps. Foundation layer.

## File layout

### `packages/constructs/`

```
src/
  index.ts          # public exports
  base.ts           # SverkaConstruct extends Construct
  constructs.ts     # Project, Pipeline, Step, ShellStep, Entry
  model.ts          # Trigger, Reference, Runtime, Input, Output types + factories
  errors.ts         # ConstructError
  __tests__/
    constructs.test.ts   # tests 1-4, 8-11 from spec 01
    model.test.ts        # tests 5-7 from spec 01
```

### `packages/core/`

```
src/
  index.ts          # public exports
  graph.ts          # Definition Graph types (spec 02)
  synthesize.ts     # synthesize() + operation normalization + dependency inference
  validate.ts       # validation (cycles, unknown producers, collisions, incompatible)
  errors.ts         # SynthesisError
  __tests__/
    graph.test.ts         # tests 1-7 from spec 02
    synthesize.test.ts    # tests 1-8, 13-14 from spec 05
    validate.test.ts      # tests 9-12 from spec 05
```

## TDD steps

### Step 1: Scaffold packages

Create `packages/constructs/` and rebuild `packages/core/` with:
- `package.json` (name, type:module, main/module/types .mjs/.d.mts, exports, scripts)
- `project.json` (nx targets: build/test/lint/typecheck)
- `tsdown.config.ts` (entry, esm, dts, clean)
- `tsconfig.json` (extends ../../tsconfig.base.json)
- `src/index.ts` (empty exports)

Add `constructs@10.8.1` to `packages/constructs/package.json` dependencies.
Add `@sverka/constructs: "workspace:*"` to `packages/core/package.json` dependencies.

Delete old `packages/core/src/` contents (composables, operation.ts, runtime.ts,
errors.ts, internal/, __tests__/) — full rebuild.

**Verify:** `bun install` succeeds; `bun run build` emits dist for both packages.

### Step 2: Model types (spec 01 — model.ts)

Write `packages/constructs/src/model.ts` with Trigger, Reference, Runtime, Input,
Output types and `push()`/`changeRequest()`/`manual()` factories.

Write `packages/constructs/src/__tests__/model.test.ts` (spec 01 tests 5-7).

**Verify:** `bun run test --filter constructs` passes; typecheck clean.

### Step 3: Error class (spec 01 — errors.ts)

Write `packages/constructs/src/errors.ts` with `ConstructError` + codes.

**Verify:** typecheck clean.

### Step 4: Construct classes (spec 01 — base.ts, constructs.ts)

Write `packages/constructs/src/base.ts` (SverkaConstruct).
Write `packages/constructs/src/constructs.ts` (Project, Pipeline, Step,
ShellStep, Entry).

Write `packages/constructs/src/__tests__/constructs.test.ts` (spec 01 tests
1-4, 8-11).

Key implementation details:
- `SverkaConstruct extends Construct` — empty body, insulation layer.
- `Project` — constructor takes `id: string`, passes `undefined` as scope.
- `Pipeline` — validates `scope instanceof Project` in constructor.
- `Step` (abstract) — validates `scope instanceof Pipeline`. Stores props.
- `ShellStep extends Step` — adds `command` from props.
- `Entry` — validates `scope instanceof Pipeline`. Stores trigger + roots.
- Duplicate id detection: `constructs` throws naturally on duplicate child
  names. Wrap the `constructs` error in `ConstructError(DUPLICATE_ID)` in
  each constructor's try/catch so callers get Sverka's error type, not
  `constructs`'s internal error.
- `INVALID_SCOPE`: check parent type in constructor, throw `ConstructError`.
- `INVALID_OUTPUT`: validate artifact outputs have `path` in Step constructor.

**Verify:** `bun run test --filter constructs` all pass; typecheck + lint clean.

### Step 5: Public exports (spec 01 — index.ts)

Write `packages/constructs/src/index.ts` with all exports per spec.

**Verify:** `bun run build --filter constructs` emits dist/index.mjs +
dist/index.d.mts; build clean.

### Step 6: Definition Graph types (spec 02 — graph.ts)

Write `packages/core/src/graph.ts` with all Definition Graph types.

Write `packages/core/src/__tests__/graph.test.ts` (spec 02 tests 1-7).

These are type-only — tests verify TypeScript compilation and object shape.

**Verify:** `bun run test --filter core` passes; typecheck clean.

### Step 7: Synthesis errors (spec 05 — errors.ts)

Write `packages/core/src/errors.ts` with `SynthesisError` + codes.

**Verify:** typecheck clean.

### Step 8: Synthesis function (spec 05 — synthesize.ts)

Write `packages/core/src/synthesize.ts` with `synthesize(project: Project)`:

1. Traverse `project.node.children` → find all Pipeline constructs.
2. For each Pipeline, traverse children → find Step and Entry constructs.
3. For each Step:
   - Create shell operation from `command`.
   - Create exportOutput/exportArtifact operations from `outputs`.
   - Create importArtifact operations from artifact StepRefs in `inputs`.
   - Collect StepRefs for dependency inference.
4. Infer dependencies:
   - StepRef with `type: "artifact"` → artifact dependency.
   - StepRef with scalar type → value dependency.
   - `dependsOn` entries → control dependency.
   - Deduplicate.
5. Build StepDefinition, EntryDefinition, PipelineDefinition, DefinitionGraph.

Write `packages/core/src/__tests__/synthesize.test.ts` (spec 05 tests 1-8,
13-14).

Step ID = step's construct path relative to project (e.g. `ci/build`).
Pipeline ID = pipeline's construct path relative to project (e.g. `ci`).

**Verify:** `bun run test --filter core` all pass; typecheck clean.

### Step 9: Validation (spec 05 — validate.ts)

Write `packages/core/src/validate.ts`:

- `detectCycles(steps)`: DFS on dependency edges. Throw `SynthesisError(CYCLE)`.
- `validateReferences(steps)`: check all StepRefs point to existing steps.
  Throw `SynthesisError(UNKNOWN_PRODUCER)`.
- `validateOutputCollisions(steps)`: check no duplicate output names per step.
  Throw `SynthesisError(OUTPUT_COLLISION)`.
- `validateReferenceTypes(steps)`: check StepRef type matches producer output
  type. Throw `SynthesisError(INCOMPATIBLE_REFERENCE)`.

Wire validation into `synthesize()` after graph construction, before return.

Write `packages/core/src/__tests__/validate.test.ts` (spec 05 tests 9-12).

**Verify:** `bun run test --filter core` all pass; typecheck clean.

### Step 10: Public exports + final gates (spec 02, 05 — index.ts)

Write `packages/core/src/index.ts`:

```ts
export type { DefinitionGraph, ProjectDefinition, PipelineDefinition,
  EntryDefinition, StepDefinition, OperationDefinition, Dependency } from "./graph.js";
export { synthesize } from "./synthesize.js";
export { SynthesisError, type SynthesisErrorCode } from "./errors.js";
```

Run package-level gates for constructs + core only:

```bash
npx nx run-many --target=test --projects=constructs,core
npx nx run-many --target=typecheck --projects=constructs,core
npx nx run-many --target=lint --projects=constructs,core
npx nx run-many --target=build --projects=constructs,core
```

**NOTE:** The full monorepo (`bun run test`) will FAIL — rebuilding `core`
breaks `ir`, `sdk`, `planner`, `runtime`, `checks`, `cli`, `policy`,
`compiler-github`, `compiler-gitlab` which all import from old `core`. These
packages are rebuilt in later waves (B–L). Only `constructs` + `core` gates
must pass in Wave A. The old packages are dead code awaiting their rebuild wave.

**Verify:** constructs + core tests pass. No `any` in impl. Typecheck + lint +
build clean for both packages.

## Conformance seed test

The conformance seed (spec 05 test 13) builds a representative Pipeline:

```text
Pipeline "ci"
  Step "build":  sh "npm run build" → outputs: { dist: artifact("./dist"), version: string }
  Step "test":   sh "npm test"     → inputs: [stepOutput("build", "dist", artifact)]
                                     dependsOn: ["build"]
  Step "deploy": sh "deploy"        → inputs: [stepOutput("build", "version", string)]
  Entry "on-push": push() → roots: ["build"]
```

Expected graph:
- `ci/build`: operations [shell, exportArtifact(dist), exportOutput(version)],
  no dependencies.
- `ci/test`: operations [shell, importArtifact(dist from build)],
  dependencies [{kind:artifact, producer:ci/build, output:dist}].
- `ci/deploy`: operations [shell],
  dependencies [{kind:value, producer:ci/build, output:version}].
- Entry `ci/on-push`: trigger push, roots [ci/build].

This seed is the canonical fixture for §33.1 authoring conformance. Waves C
and D will assert SDK and Decorator APIs produce the same graph.

## Scaffolding notes for builder

- `package.json`: copy `packages/findings/package.json` template. Change name,
  add deps. Keep .mjs/.d.mts, scripts, files:[dist].
- `project.json`: copy `packages/findings/project.json` template. Change name
  and cwd. Lint: `eslint src` (no --ext). Test: `vitest run --passWithNoTests`.
- `tsdown.config.ts`: copy findings template. Entry: `src/index.ts`.
- `tsconfig.json`: copy findings template.
- `constructs` package: add `"constructs": "10.8.1"` to dependencies.
- `core` package: add `"@sverka/constructs": "workspace:*"` to dependencies.
  Delete all old src/ files first.
- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- `exactOptionalPropertyTypes: true` — don't set optional props to `undefined`.
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`.
- `noImplicitOverride: true` — error classes use `override readonly cause`.
