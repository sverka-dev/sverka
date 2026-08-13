# Wave C Implementation Plan — SDK Authoring Layer

**Spec:** 03-authoring-sdk
**Package:** `@sverka/sdk` (rebuilt)
**Date:** 2026-08-13

## Package dependency

```text
@sverka/sdk → @sverka/cdk
  (Project, Pipeline, ShellStep, Entry, model types)
```

No `@sverka/core` dependency — the SDK builds construct trees, it does not
synthesize. Synthesis is the caller's responsibility (or the CLI's).

## Reuse vs. rebuild

The old `@sverka/sdk` was a composition root that wired together core/ir/
runtime/findings/policy. That entire API (`defineWorkflow`, `task`, `run`,
`pipeline`, `createSverka`) is **discarded** — it was the flat Plan model.

The new SDK is much simpler: composables that build construct trees. No
runtime, no IR, no policy. Just factory functions over `@sverka/cdk`.

## File layout

### `packages/sdk/`

```text
src/
  index.ts          # public exports
  sh.ts             # sh tagged template + StepBuilder
  artifact.ts       # artifact() factory
  pipeline.ts       # pipeline() factory + PipelineConfig
  when.ts           # when() condition helper
  images.ts         # images object + image() factory + ImageRef
  context.ts        # env, secrets, git, change, event, run, inputs namespaces
  errors.ts         # SdkError
  __tests__/
    sh.test.ts           # tests 1-5
    artifact.test.ts     # test 6
    pipeline.test.ts     # test 7
    when.test.ts         # test 8
    images.test.ts       # tests 9-11
    context.test.ts      # tests 12-14
    conformance.test.ts  # test 15
    errors.test.ts       # test 16
    public-api.test.ts   # test 17
```

## TDD steps

### Step 1: Scaffold

Delete old SDK source. Update `package.json` deps: `@sverka/cdk:
"workspace:*"` only (remove all old deps). Fix `project.json` lint target
(remove `--ext .ts`). Create empty `src/index.ts`.

### Step 2: Error classes

Write failing tests: `SdkError` extends Error, has `code` field, `override
readonly cause`. Implement `errors.ts`.

### Step 3: artifact factory

Write failing test: `artifact("./dist")` returns `{ type: "artifact", path:
"./dist" }`. Implement `artifact.ts` (one-liner).

### Step 4: Context namespaces

Write failing tests: `env.CI_TRACE`, `git.sha`, `inputs.environment` all
return `ContextRef` objects. Implement `context.ts` using `Proxy` for dynamic
fields (`env`, `secrets`, `inputs`) and static objects for fixed fields
(`git`, `change`, `event`, `run`).

### Step 5: images

Write failing tests: `images.node[22]`, `images.ubuntu.latest`, `image(...)`.
Implement `images.ts` using `Proxy` for numeric index access on `images.node`.

### Step 6: sh + StepBuilder

Write failing tests: `sh` template creates StepBuilder, interpolation works,
`outputs()`, `build()` creates ShellStep. Implement `sh.ts`.

### Step 7: pipeline factory

Write failing test: `pipeline()` creates Pipeline, runs step/entry functions.
Implement `pipeline.ts`.

### Step 8: when

Write failing test: `when(ref)` returns ref unchanged. Implement `when.ts`
(identity function in v0).

### Step 9: Conformance test

Write the conformance test: build the same build→test→deploy pipeline using
SDK composables, synthesize it, and compare the Definition Graph to the
Construct API version. They must be identical.

### Step 10: Public API + gates

Write `public-api.test.ts`. Implement `index.ts`. Run all gates:

```bash
bun run test --filter @sverka/sdk
bun run typecheck --filter @sverka/sdk
bun run lint --filter @sverka/sdk
bun run build --filter @sverka/sdk
```

Full monorepo test expected to fail (old sdk dependents — cli — reference
old API). Only sdk gates must pass.
