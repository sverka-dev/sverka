# Wave 3 — Runtime Package Implementation Plan

**Architect:** architect-1
**Spec:** `specs/03-runtime/spec.md`
**Epic:** sv-jy5 (Wave 3: Runtime package)
**Design task:** sv-kcn
**Builder task:** sv-x2v
**Reviewer task:** sv-l97
**Package:** `@sverka/runtime` → `packages/runtime`

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Scope

Implement the backend-agnostic runtime for `@sverka/runtime`:

- `Executor` interface + `ExecuteRequest` / `ExecuteResult`.
- `StateStore` interface (persistence; optional in config).
- `CacheBackend` interface + `CacheKey` / `CacheEntry` (optional in config).
- `Scheduler` class: topological sort, concurrent execution up to
  `maxConcurrent`, optional CPU/memory limits via an internal resource pool,
  dependent cancellation on fatal failure, `continueOnError`, retry policy,
  optional state persistence + resume, optional cache reuse, log/artifact
  collection.
- Result types: `OperationOutcome`, `ExecutionResult`, `ExecutionState`.
- Error hierarchy: `RuntimeExecutionError` → `SchedulerError`, `ExecutorError`.
- Public re-exports from `src/index.ts`.

**Dependency:** `runtime` depends on `@sverka/ir` only (for `Plan`,
`PlanOperation`). `@sverka/core` is NOT a direct dependency — `OperationKind`
flows transitively through `PlanOperation.kind`. If the builder finds a
concrete need for a core type, add `@sverka/core: workspace:*` then; do not
add speculatively. (Note: `engdocs/architecture/dependencies.md` rule 3 lists
core; this plan deviates because the spec uses no core type directly. Update
the doc if the deviation holds after implementation.)

**Out of scope (filed as follow-ups):**
- Critical-check prioritization (needs IR `tags`/`critical` field).
- Concrete file-backed `StateStore`/`CacheBackend` (this wave: interfaces +
  in-test mocks only).

## 2. Scaffolding status (already done by architect)

- `packages/runtime/package.json` — fixed: dist paths are `.mjs`/`.d.mts`
  (matches `core`/`ir` and tsdown ESM output), `@sverka/ir: workspace:*`
  added to `dependencies`.
- `packages/runtime/project.json` — already has `--passWithNoTests` on the
  test target (matches core/ir).
- `packages/runtime/tsconfig.json`, `tsdown.config.ts` — already match
  `core`/`ir`; no changes needed.
- `packages/runtime/src/index.ts` — placeholder; builder fills exports.

The builder must run `bun install` once after pulling the new
`@sverka/ir` dependency so the workspace link resolves.

## 3. File layout

Mirror `core`/`ir` layout (one module per concern, `__tests__/` co-located,
internal helpers under `internal/`):

```
packages/runtime/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  errors.ts             # RuntimeExecutionError, SchedulerError, ExecutorError
  executor.ts           # Executor, ExecuteRequest, ExecuteResult
  result.ts             # OperationOutcome, ExecutionResult, ExecutionState
  state-store.ts        # StateStore interface
  cache.ts              # CacheBackend, CacheKey, CacheEntry
  scheduler.ts          # Scheduler class + SchedulerConfig
  internal/
    topo.ts             # topological sort + cycle detection + dependent set
    resource-pool.ts    # internal ResourcePool (only used when limits set)
    parse.ts            # parse cpu ("2","0.5") and memory ("512Mi","2Gi")
  __tests__/
    errors.test.ts
    executor.test.ts       # type-level + mock executor helper
    scheduler.test.ts      # the big one: topo, concurrency, failure, retry
    state-store.test.ts    # resume + persistence via mock StateStore
    cache.test.ts          # cache hit/miss via mock CacheBackend
    result.test.ts         # status semantics
    public-api.test.ts
    helpers/
      fixtures.ts          # plan factory + mock executor/state/cache
```

`internal/` is NOT exported. `resource-pool.ts` is internal — `ResourcePool`
is not in the public surface (spec removed it from exports).

## 4. Implementation order (TDD: tests first, then impl)

The builder writes tests before each module. Suggested commit-sized slices:

### Slice A — Errors (foundation, no deps)
1. `errors.test.ts` — `RuntimeExecutionError` base, `SchedulerError`/
   `ExecutorError` codes and `instanceof` chain. Mirror `ir/src/errors.ts`
   exactly (constructor sets `name`, calls `super`).
2. `errors.ts` — implement.
3. Wire into `index.ts`.

### Slice B — Type-only modules (no runtime)
4. `executor.ts` — `Executor`, `ExecuteRequest`, `ExecuteResult` interfaces.
   `import type { PlanOperation } from "@sverka/ir"`.
5. `result.ts` — `OperationOutcome`, `ExecutionResult`, `ExecutionState`.
6. `state-store.ts` — `StateStore` interface (`import type { ExecutionState }`).
7. `cache.ts` — `CacheBackend`, `CacheKey`, `CacheEntry`.
8. Export all from `index.ts`.
9. `public-api.test.ts` (skeleton) — assert every exported symbol importable.

### Slice C — Internal helpers
10. `internal/parse.ts` — `parseCpu(s: string): number` (handles "2", "0.5",
    "1.5"), `parseMemory(s: string): number` (handles "512Mi", "2Gi", "1Ti",
    bare bytes). **Test first:** each format parses to the right byte count.
11. `internal/topo.ts` — `topoSort(ops): string[] | { cycle: string[] }`
    (returns sorted ids or a cycle path), `dependentsOf(ops, id): Set<string>`
    (transitive dependents for cancellation). **Test first:** linear, diamond,
    independent, cycle.
12. `internal/resource-pool.ts` — `ResourcePool` class with
    `tryAcquire(cpu, memory): boolean`, `release(cpu, memory): void`,
    `availableCpu`, `availableMemory`. Uses `parseCpu`/`parseMemory`.
    **Test first:** acquire/release accounting, over-request returns false.

### Slice D — Scheduler core (topo + concurrency + failure)
13. `helpers/fixtures.ts` — `makePlan(overrides)`, `mockExecutor` (records
    calls, configurable `canExecute` + canned `ExecuteResult`), helpers to
    build a minimal valid `Plan` (reuse `@sverka/ir` `computePlanId`).
14. `scheduler.test.ts` — topological scheduling (linear, diamond,
    independent), concurrency (`maxConcurrent` 1 vs 2), failure cancellation
    (fatal failure cancels dependents), `continueOnError` (independent
    branch proceeds, dependents still cancelled), `cancel()` → partial,
    executor routing + `NO_EXECUTOR`, logs/artifacts collected.
15. `scheduler.ts` — implement the core loop:
    - Build ready set from topo sort.
    - Run up to `maxConcurrent` concurrently; when one finishes, schedule
      the next ready op whose deps are all satisfied.
    - On fatal failure (status=failure, continueOnError=false): compute
      transitive dependents, mark them cancelled, remove from ready set.
    - On `continueOnError=true` failure: record failure, cancel only that
      op's dependents, continue independent branches.
    - `cancel()`: set a flag; running ops get cancelled status; resolve
      partial.
    - Select executor via `canExecute`; throw `SchedulerError(NO_EXECUTOR)`
      if none matches.
    - Wrap executor throws in `ExecutorError`.
    - Collect logs + artifacts from `ExecuteResult` into `OperationOutcome`.
    - Compute final `ExecutionResult.status` per spec semantics.

### Slice E — Retry policy
16. Extend `scheduler.test.ts` — `maxAttempts: 3` fail-twice-then-succeed →
    success; fail-all → failure; `retryOn: ["timeout"]` no retry on
    non-timeout; `backoffSeconds` delays (use vi fake timers).
17. Implement retry in `scheduler.ts`: loop up to `maxAttempts`, sleep
    `backoffSeconds` between attempts (use a cancellable sleep — if
    `cancel()` fires during backoff, abort). Only retry if the failure
    kind matches `retryOn` (the executor reports timeout via `error`
    containing "timeout" — document this contract: executor sets `error`
    to a string containing "timeout" when `timeoutSeconds` is exceeded).

### Slice F — Resource limits (optional)
18. Extend `scheduler.test.ts` — `totalCpu: 4`, two ops requesting 4 CPU run
    sequentially; two ops requesting 2 CPU run concurrently; op requesting
    more than `totalCpu` → `INSUFFICIENT_RESOURCES`.
19. Wire `ResourcePool` into the scheduler: when `totalCpu`/`totalMemory`
    set, acquire before execute, release after. When not set, skip pool
    entirely (only `maxConcurrent` limits).

### Slice G — State persistence + resume (optional)
20. `state-store.test.ts` — after running `a`+`b`, mock store has both
    completed; resumed run skips them; "running" ops re-run on resume;
    `load` failure → `STATE_LOAD_ERROR`; no store configured → no persistence.
21. Wire `StateStore` into scheduler: after each op completes, call
    `stateStore.save` (best-effort, catch + log). On `execute()` start, if
    `resume && stateStore`, call `load`; on throw → `STATE_LOAD_ERROR`.
    Skip already-completed ops; re-run "running" ops.

### Slice H — Cache reuse (optional)
22. `cache.test.ts` — cache hit → `fromCache: true`, not executed; miss →
    executed + `store` called; no cache configured → all `fromCache: false`.
23. Wire `CacheBackend`: before executing an op with `cache` declared, call
    `cache.get`; on hit, `cache.restore` + mark success/fromCache. On miss,
    execute then `cache.store` + `cache.put`.

### Slice I — Public API + gates
24. Complete `index.ts` exports to match spec §Interfaces exactly.
25. `public-api.test.ts` — every symbol importable + exercised.
26. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All must be green.

## 5. Convention checklist (enforced by reviewer)

- **No `any`.** Use `unknown` + narrow. No `@ts-ignore`/`@ts-expect-error`.
- **`verbatimModuleSyntax: true`** → all type-only imports use `import type`.
- **`exactOptionalPropertyTypes: true`** → never assign `undefined` to an
  optional field; use conditional spread (see `core`/`ir` test helper
  pattern: `...(x !== undefined ? { x } : {})`).
- **`noUncheckedIndexedAccess: true`** → array/object access returns
  `T | undefined`; narrow before use.
- **readonly everywhere** — all interface fields are `readonly`.
- **Error `name`** — each error subclass sets `this.name` in the constructor
  (matches `core`/`ir`).
- **ESM only** — `.js` specifiers in imports (TS `moduleResolution: bundler`
  resolves them). No `.cjs`/`.mjs` source.
- **Public surface** — everything in spec §Interfaces is exported from
  `src/index.ts`; nothing else is. `ResourcePool` is NOT exported.
- **Test command** — `bun run test` (vitest via nx). NEVER `bun test`
  (that runs Bun's built-in runner whose vi shim lacks `vi.hoisted`).

## 6. Edge cases the builder must handle

- **Empty plan** — a plan with zero operations is invalid per IR validation,
  but the scheduler should return `{ status: "success", outcomes: Map() }`
  defensively rather than throw.
- **Cycle defense** — IR validation rejects cycles, but the scheduler's
  `topoSort` must detect one and throw `SchedulerError(CYCLE_DETECTED)`
  with the cycle path in `context`.
- **Self-loop** — an op depending on itself is a cycle of length 1.
- **`cancel()` during backoff sleep** — the retry sleep must be cancellable;
  if `cancel()` fires, abort the retry, mark the op cancelled, resolve
  partial. Use `AbortSignal` or a flag check after sleep.
- **`cancel()` during resource wait** — if an op is waiting for resources
  and `cancel()` fires, mark it cancelled, don't execute.
- **Executor `dispose()`** — call `dispose()` on executors that implement it
  when `Scheduler.dispose()` is called. Never throw if an executor lacks it.
- **`stateStore.save` failure** — catch, log (console.warn), continue. Never
  fail the run because persistence failed.
- **Resume with no prior state** — `load` returns `undefined`; run from
  scratch.
- **Cache `restore` failure** — treat as a cache miss; execute the op.
- **`continueOnError` + dependents** — even with `continueOnError: true`,
  the failed op's transitive dependents are cancelled (their input is
  unavailable). Only independent branches continue.
- **CPU/memory parsing** — `cpu` is a decimal string ("2", "0.5", "1.5");
  `memory` matches `/^[0-9]+(Ki|Mi|Gi|Ti)?$/` (bare number = bytes).
  Reuse the same format the IR validator accepts (see IR spec rule 9).

## 7. Error code map

The builder should use these stable `code` strings (reviewer checks them):

| Condition              | code                    | error class      |
|------------------------|-------------------------|------------------|
| No executor for op     | `NO_EXECUTOR`           | `SchedulerError` |
| Cycle in plan DAG      | `CYCLE_DETECTED`        | `SchedulerError` |
| Op exceeds totalCpu/Mem| `INSUFFICIENT_RESOURCES`| `SchedulerError` |
| State load failure     | `STATE_LOAD_ERROR`      | `SchedulerError` |
| Executor threw         | `EXECUTOR_ERROR`        | `ExecutorError`  |

`ExecutorError` wraps executor exceptions; the operation outcome is
`status: "failure"` with the wrapped message. `SchedulerError` is raised for
scheduling-level problems that abort the run.

## 8. Gates (reviewer runs these)

```bash
bun install              # resolve new @sverka/ir dep
bun run test             # vitest via nx (NOT `bun test`)
bun run typecheck        # strict, no any
bun run lint             # eslint clean
bun run build            # tsdown produces dist/index.mjs + .d.mts
```

Acceptance criteria: all gates green; spec §Test plan items 1–10 pass.

## 9. Out of scope for this wave

- Concrete executors (`runtime-docker`, `runtime-host`, etc.) — later waves.
- Concrete file-backed `StateStore`/`CacheBackend` — later wave.
- Critical-check prioritization — needs IR schema change; follow-up issue.
- Condition evaluation — planner's job; runtime ignores `condition`.
- Findings normalization — `findings` package.
- CLI integration — `cli` package.
