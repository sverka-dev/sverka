# Wave 09 — SDK Package Implementation Plan

## Spec: `specs/09-sdk/spec.md` (trimmed from 417 → ~230 lines)

## Key design decisions

1. **Compile mode CUT.** Compilers are waves 12–13. SDK gains `compile()` then.
2. **Findings extraction stubbed.** `execute()` returns `findings: []` until check providers (wave 11). Pipeline is wired end-to-end; findings populate later.
3. **SDK is the composition root.** Only package that imports `core`, `planner`, `ir`, `runtime`, `runtime-host`, `runtime-docker`, `findings`, `policy`. The `OperationSpec[] → Plan` conversion lives here.
4. **Default executor: host.** No Docker dependency for basic usage. Docker is opt-in via `SverkaOptions.executor: "docker"`.
5. **`task` is a thin SDK helper**, not a core re-export (core doesn't export it). One line: `op.named(name)`.
6. **`loadWorkflow` uses dynamic `import()`.** Bun handles `.ts` natively. Node uses `.js` fallback (findConfig searches `.ts` then `.js`). No new dependency.
7. **No output formatting.** SDK returns structured data. CLI (wave 10) formats.

## Dependencies (workspace)

```
@sverka/core
@sverka/ir
@sverka/planner
@sverka/runtime
@sverka/runtime-host
@sverka/runtime-docker
@sverka/findings
@sverka/policy
```

No new external dependencies. Node builtins only (`node:fs`, `node:path`, `node:crypto`, `node:url`).

## File layout

```
packages/sdk/
  package.json          # workspace deps, .mjs/.d.mts dist
  project.json          # nx targets (lint: no --ext)
  tsconfig.json
  tsdown.config.ts
  src/
    index.ts            # public re-exports + task + defineWorkflow
    types.ts            # SverkaOptions, PlanResult, ExecutionResult, WorkflowDefinition, SdkError
    config.ts           # findConfig, loadWorkflow
    convert.ts          # OperationSpec[] → Plan (the composition glue)
    sverka.ts           # createSverka, plan(), execute()
    internal/
      plan-runtime.ts   # plan-mode Runtime impl (records operations, no side effects)
    __tests__/
      re-exports.test.ts
      task.test.ts
      define-workflow.test.ts
      find-config.test.ts
      load-workflow.test.ts
      convert.test.ts
      plan-mode.test.ts
      execute-mode.test.ts
      errors.test.ts
      public-api.test.ts
      helpers/
        fixtures.ts     # temp dirs, sample configs, mock executors
```

## TDD steps (10 steps)

### Step 1: Scaffold

Create `packages/sdk/` with `package.json`, `project.json`, `tsconfig.json`,
`tsdown.config.ts`. Add workspace deps (all 8 packages above). Fix
scaffolding per wave 6/7/8 lessons:
- `package.json` dist: `.mjs` / `.d.mts` (not `.js` / `.d.ts`)
- `project.json` lint: `eslint src` (no `--ext .ts`)
- `tsconfig.json`: extends root, strict, ESM

Add `packages/sdk` to nx `~workspace` project graph if needed.

**Verify:** `bun install` succeeds, `bun run build` builds sdk, empty
`src/index.ts` compiles.

### Step 2: Re-exports + public API test

Write `re-exports.test.ts` and `public-api.test.ts` FIRST (TDD).

Test that importing `@sverka/sdk` gives:
- Composables: `pipeline`, `run`, `parallel`, `when`, `matrix`, `workflow` (callable)
- Core types: `Operation`, `OperationSpec`, `Workflow`, etc. (typeof check)
- IR: `validatePlan`, `computePlanId` (callable)
- Planner: `createPlanner` (callable)
- Findings: `normalizeSarif`, `computeFingerprint`, `loadBaseline`, `filterOnlyNew`
- Policy: `DEFAULT_POLICY`, `createPolicy`, `evaluatePolicy`
- SDK: `task`, `defineWorkflow`, `findConfig`, `loadWorkflow`, `createSverka`, `plan`, `execute`, `SdkError`

Then write `src/index.ts` with all re-exports. Types are `export type`,
functions are `export`.

**Verify:** `bun run test --filter=sdk` passes re-exports + public-api tests.

### Step 3: `task` helper

Write `task.test.ts`:
- `task("lint", run({...}))` returns an `Operation`
- The operation's spec has `name: "lint"`
- Equivalent to `run({...}).named("lint")`

Implement in `src/index.ts` (or a small `task.ts`):
```typescript
export function task(name: string, op: Operation): Operation {
  return op.named(name);
}
```

**Verify:** task test passes.

### Step 4: `defineWorkflow`

Write `define-workflow.test.ts`:
- Returns the same object passed in (identity)
- Has the correct shape

Implement in `src/types.ts` or `src/index.ts`:
```typescript
export function defineWorkflow(d: WorkflowDefinition): WorkflowDefinition {
  return d;
}
```

**Verify:** test passes.

### Step 5: `findConfig`

Write `find-config.test.ts`:
- Finds `sverka.config.ts` in root
- Finds in parent directory (create temp dir structure)
- Falls back to `sverka.config.js`
- Returns `null` after 5 levels

Implement `src/config.ts`:
- Walk upward from `root`, up to 5 parents
- For each dir: check `sverka.config.ts`, then `sverka.config.js`
- Use `node:fs` `existsSync`, `node:path` `resolve`/`dirname`
- Return first match or `null`

**Verify:** test passes.

### Step 6: `loadWorkflow`

Write `load-workflow.test.ts`:
- Loads a valid `sverka.config.ts` (create temp file with `defineWorkflow`)
- Returns `WorkflowDefinition` with correct shape
- Throws `SdkError` with `CONFIG_INVALID` when default export is malformed (not an object, missing `name` or `workflow`)
- Throws `SdkError` with `CONFIG_LOAD_FAILED` when file has syntax error (cause preserved)
- Throws `SdkError` with `CONFIG_NOT_FOUND` when file doesn't exist

Implement in `src/config.ts`:
- `await import(path)` (use `pathToFileURL` from `node:url` for Windows compat)
- Check `module.default` exists and is an object with `name: string` and `workflow` having `roots`
- Wrap import errors in `SdkError(CONFIG_LOAD_FAILED, ..., originalError)`
- Wrap validation errors in `SdkError(CONFIG_INVALID)`

**Verify:** test passes.

### Step 7: `OperationSpec[] → Plan` conversion

Write `convert.test.ts`:
- Convert a simple `OperationSpec[]` (from `workflow.plan(planRuntime)`) to a `Plan`
- All required `PlanOperation` fields are filled with defaults
- `validatePlan(plan)` returns `{ valid: true }`
- `computePlanId` is deterministic (same input → same id)
- `executor.type` defaults to `"host"`, changes to `"docker"` when `spec.image` is set
- `timeoutSeconds` defaults to 300
- `resources` defaults to `{ cpu: "1", memory: "512Mi" }`
- `dependsOn` defaults to `[]`

Implement `src/convert.ts`:
- `convertToPlan(operations: readonly OperationSpec[], opts: { name: string, executor: "host" | "docker", context?: ProjectContext }): Plan`
- Map each `OperationSpec` → `PlanOperation` per the table in spec
- Assemble `Plan` with `computePlanId`, `createdAt`, `metadata`
- `sourceContextHash`: SHA-256 of `context.commit + context.dirty + changedFilePaths.join(",")` or `""`

**Verify:** test passes, `validatePlan` returns valid.

### Step 8: Plan-mode `Runtime` + `plan()` function

Write `plan-mode.test.ts`:
- Auto-discovery: `plan()` with no config → `PlanResult` with `context`, `proposal`, `operations: []`
- With config: `plan({ configPath })` → `PlanResult` with `context`, `operations` (from graph), `proposal: null`
- No side effects (no commands executed)

Implement `src/internal/plan-runtime.ts`:
- `PlanRuntime` implements `Runtime` with `mode: "plan"`
- `evaluate(op)`: records the `OperationSpec`, returns `{ status: "planned", operationId, durationMs: 0 }`
- `finalize()`: returns `{ mode: "plan", operations: recorded, durationMs }`

Implement `src/sverka.ts`:
- `createSverka(defaultOptions?)`: returns `Sverka`
- `sverka.plan(options?)`:
  1. Resolve options (merge defaults)
  2. `planner.discover({ root, baseRef })` → `ProjectContext`
  3. `findConfig(root)` or use `configPath`
  4. If config: `loadWorkflow` → evaluate `workflow.plan(new PlanRuntime())` → `OperationSpec[]`
  5. If no config: `planner.plan(context)` → `PlanProposal`
  6. Return `PlanResult`

**Verify:** test passes.

### Step 9: `execute()` function

Write `execute-mode.test.ts`:
- `execute()` with a simple config (one `run` command) → `ExecutionResult`
- `status` is `"success"` when command succeeds, `"failure"` when it fails
- `findings` is `[]`
- `verdict` is `"pass"` when status is success, `"fail"` otherwise
- `policyResult` is from `evaluatePolicy([], DEFAULT_POLICY, [])`
- `outcomes` map has entries for each operation
- `execute()` with `baselinePath` + `onlyNew` loads baseline and filters
- `execute()` wraps runtime errors in `SdkError(EXECUTION_FAILED)`

Implement in `src/sverka.ts`:
- `sverka.execute(options?)`:
  1. Resolve options
  2. Discover context
  3. Load config or auto-discover
  4. Evaluate workflow graph → `OperationSpec[]`
  5. `convertToPlan(operations, { name, executor, context })` → `Plan`
  6. `validatePlan(plan)`
  7. Construct executor:
     - `host`: `new HostExecutor({ enabled: true, allowlist: createAllowlist(["*"]), envAllowlist: [] })`
     - `docker`: `new DockerExecutor({ ... })` (minimal config)
  8. `new Scheduler({ executors: [executor], maxConcurrent: 4, workspace: root, artifactDir, cacheDir, credentials: {}, resume: false })`
  9. `scheduler.execute(plan)` → runtime `ExecutionResult`
  10. `findings = []` (stub — wave 11 adds extraction)
  11. If `baselinePath` + `onlyNew`: `loadBaseline`, `filterOnlyNew(findings, baseline)`
  12. `policy = config?.policy ? createPolicy(config.policy) : DEFAULT_POLICY`
  13. `policyResult = evaluatePolicy(findings, policy, baselineFingerprints)`
  14. `verdict = status === "success" ? policyResult.verdict : "fail"`
  15. Return `ExecutionResult`

**Verify:** test passes. Use a real `run({ command: "true" })` for success, `run({ command: "false" })` for failure.

### Step 10: Error handling + `createSverka` defaults

Write `errors.test.ts`:
- `CONFIG_INVALID` for malformed default export
- `CONFIG_LOAD_FAILED` preserves cause
- `CONFIG_NOT_FOUND` when no config and no proposal
- `EXECUTION_FAILED` wraps runtime errors
- `createSverka` defaults applied to subsequent calls
- Per-call options override defaults

Wire error wrapping in `src/sverka.ts` and `src/config.ts`.

**Verify:** all tests pass.

## Final gates (builder must verify ALL)

```bash
# Package-level
bun run test --filter=sdk          # all sdk tests pass
bun run typecheck --filter=sdk     # 0 errors
bun run lint --filter=sdk          # 0 errors
bun run build --filter=sdk         # dist/index.mjs + index.d.mts emitted

# Full monorepo (catch entangled breakage)
bun run test                       # 16+ projects green
bun run typecheck                  # 0 errors
bun run lint                       # 0 errors
bun run build                      # all packages build
```

## Commit hygiene (for finalize)

Stage ONLY:
- `packages/sdk/**`
- `specs/09-sdk/spec.md`
- `engdocs/architecture/wave-09-sdk-plan.md`
- `bun.lock` (if workspace deps changed it)

EXCLUDE:
- `city.toml`
- `agents/`
- `.devin/`
- `.gc/`
- `.beads/`
- `.evidence/`
- `.opencode/`
- `formulas/sverka-address-review.toml`

## Scaffolding fixes (per wave 6/7/8 lessons)

- `package.json` dist extensions: `.mjs` / `.d.mts` (not `.js` / `.d.ts`)
- `project.json` lint script: `eslint src` (remove `--ext .ts` — ESLint 9 flat config)
- `tsdown.config.ts`: ESM, dts
- All workspace deps as `workspace:*`

## Notes for builder

- The `HostExecutor` requires `timeoutSeconds > 0` in `canExecute`. The
  conversion fills `timeoutSeconds: 300` by default, so this is satisfied.
- The `HostExecutor` requires the command to be in the allowlist. For SDK
  usage, use `createAllowlist(["*"])` (allow all) — the SDK is the user's
  own tool, not a sandbox. The allowlist is for untrusted workflows.
- `workflow.plan(runtime)` calls `runtime.evaluate(spec)` for each
  non-skipped operation. The `PlanRuntime` records these. The `operations`
  in the `RuntimeResult` are the full topo-sorted list (including skipped
  ones with conditions). Use `result.operations` for the conversion.
- `OperationSpec.id` is assigned by core's `planWorkflow` (via
  `assignIds`). It should be non-empty after planning. If it's empty,
  the conversion should throw (defensive).
- `SdkError` must use `override readonly cause: unknown` (noImplicitOverride
  is true in tsconfig.base.json; all existing error classes in
  policy/findings use this pattern).
- The SDK re-exports `OperationOutcome` from both `@sverka/core` (as
  `OperationOutcome`) and `@sverka/runtime` (as `RuntimeOperationOutcome`).
  The `ExecutionResult.outcomes` field uses `RuntimeOperationOutcome`
  (which has `fromCache: boolean`). Don't confuse the two.
