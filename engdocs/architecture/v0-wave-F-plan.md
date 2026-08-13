# Wave F Implementation Plan — Native Engine + Runtime Drivers

**Specs:** 10-engine-native, 11-runtime-host, 12-runtime-docker
**Packages:** `@sverka/engine-native` (rebuilt from `runtime`), `@sverka/runtime-host` (adapted), `@sverka/runtime-docker` (adapted)
**Date:** 2026-08-13

## Package dependency

```text
@sverka/engine-native  →  @sverka/ir  (RunPlan, StepDefinition, InputValue)
                         @sverka/core  (StepDefinition, OperationDefinition types)
@sverka/runtime-host   →  @sverka/engine-native  (RuntimeDriver interface)
@sverka/runtime-docker →  @sverka/engine-native  (RuntimeDriver interface)
```

## Reuse vs. rebuild

### engine-native (replaces runtime)

| Old runtime file | Action | Reason |
|---|---|---|
| `scheduler.ts` (567 lines) | **Rebuild** | Operates on flat PlanOperation; new operates on StepDefinition with Dependency edges. Drop cache, retry, state-persist, resource-pool (all deferred from v0). |
| `executor.ts` (46 lines) | **Rebuild** | Old Executor executes PlanOperation; new RuntimeDriver executes shell commands. Different interface. |
| `result.ts` (44 lines) | **Rebuild** | Old OperationOutcome/ExecutionResult for flat plan; new RunEvent/RunStatus for step DAG. |
| `errors.ts` | **Rebuild** | New EngineError hierarchy. |
| `state-store.ts` | **Delete** | State persistence deferred from v0. |
| `cache.ts` | **Delete** | Cache deferred from v0 (§32). |
| `internal/topo.ts` | **Reuse concept, rewrite** | Same Kahn's algorithm, but edges come from StepDefinition.dependencies[].producer, not PlanOperation.dependsOn[]. |
| `internal/resource-pool.ts` | **Delete** | Resource pools not v0. |
| `internal/retry.ts` | **Delete** | Retry deferred (§32). |
| `internal/state-persist.ts` | **Delete** | State persistence not v0. |
| `internal/scheduler-helpers.ts` | **Delete** | Helpers for old scheduler. |
| `internal/parse.ts` | **Delete** | CPU/memory parsing for resource pools. |

### runtime-host (adapted)

| File | Action | Reason |
|---|---|---|
| `host-executor.ts` (318 lines) | **Rebuild as host-driver.ts** | Old implements Executor (PlanOperation); new implements RuntimeDriver (ShellExecuteRequest). Reuse: spawn logic, env building, log truncation, timeout/kill. |
| `allowlist.ts` | **Reuse unchanged** | Command allowlist is still needed. |
| `config.ts` | **Adapt** | Remove runAsUid (deferred). |
| `errors.ts` | **Reuse unchanged** | Same error classes. |

### runtime-docker (adapted)

| File | Action | Reason |
|---|---|---|
| `docker-executor.ts` (386 lines) | **Rebuild as docker-driver.ts** | Old implements Executor (PlanOperation); new implements RuntimeDriver (ShellExecuteRequest). Reuse: docker args building, container policy, image verification. |
| `internal/docker-cli.ts` | **Reuse** | runDocker helper. |
| `image.ts` | **Reuse** | Image digest verification. |
| `cache.ts` | **Delete** | Cache deferred (§32). |
| `config.ts` | **Adapt** | Remove cacheDir. |
| `errors.ts` | **Reuse unchanged** | Same error classes. |

## File layout

### `packages/engine-native/` (renamed from `runtime`)

```text
src/
  index.ts          # public exports
  engine.ts         # createEngine + Engine class
  scheduler.ts      # topological sort + concurrent execution
  step-executor.ts  # runs ordered operations inside a step
  events.ts         # RunEvent types
  types.ts          # RuntimeDriver, ShellExecuteRequest, ShellResult, etc.
  value-store.ts    # createValueStore + ValueStore
  artifact-store.ts # createArtifactStore + ArtifactStore
  errors.ts         # EngineError, SchedulerError, StepExecError
  __tests__/
    engine.test.ts        # tests 1-6, 14-15
    step-executor.test.ts # tests 10-13
    value-store.test.ts   # test 8
    artifact-store.test.ts # test 9
    timeout.test.ts       # test 7
    errors.test.ts        # test 16
    public-api.test.ts    # test 17
    helpers/mock-driver.ts # test mock driver
    helpers/fixtures.ts    # sample RunPlan
```

### `packages/runtime-host/` (adapted)

```text
src/
  index.ts          # public exports
  host-driver.ts    # createHostDriver + HostDriver (replaces host-executor.ts)
  allowlist.ts      # reuse unchanged
  config.ts         # adapted
  errors.ts         # reuse unchanged
  __tests__/
    host-driver.test.ts   # tests 1-9
    allowlist.test.ts     # test 10
    public-api.test.ts    # test 11
```

### `packages/runtime-docker/` (adapted)

```text
src/
  index.ts          # public exports
  docker-driver.ts  # createDockerDriver + DockerDriver (replaces docker-executor.ts)
  internal/docker-cli.ts  # reuse
  image.ts          # reuse
  config.ts         # adapted
  errors.ts         # reuse unchanged
  __tests__/
    docker-driver.test.ts # tests 1-8
    public-api.test.ts    # test 11
```

## TDD steps

### Step 1: Scaffold engine-native

Rename `packages/runtime` → `packages/engine-native`. Update package.json
(name: `@sverka/engine-native`, deps: `@sverka/ir`, `@sverka/core`). Delete
old source files. Create empty `src/index.ts`.

### Step 2: Errors + types

Write failing tests for error classes. Implement `errors.ts` and `types.ts`.

### Step 3: ValueStore + ArtifactStore

Write failing tests. Implement `value-store.ts` (in-memory Map) and
`artifact-store.ts` (filesystem copy).

### Step 4: StepExecutor

Write failing tests with a mock driver. Implement `step-executor.ts`:
- Creates per-step workspace + output dir
- Sets SVERKA_OUTPUT_DIR env var
- Runs operations in order
- exportOutput: reads from output dir, parses by type, stores in ValueStore
- exportArtifact: copies to ArtifactStore
- importArtifact: copies from ArtifactStore
- diagnostic: emits event

### Step 5: Scheduler

Write failing tests. Implement `scheduler.ts`:
- Topological sort by StepDefinition.dependencies[].producer
- Concurrent execution up to maxConcurrent
- Failure propagation (cancel dependents)
- Cancellation support

### Step 6: Engine

Write failing tests with mock driver. Implement `engine.ts`:
- `createEngine(config): Engine`
- `run(request): AsyncIterable<RunEvent>` — async generator
- `cancel(): Promise<void>`
- Emits run-started, step events, run-completed
- Driver selection

### Step 7: Timeout test

Write test: step with timeout, mock driver that sleeps, verify step-failed
with timeout.

### Step 8: Public API + gates

Write `public-api.test.ts`. Implement `index.ts`. Run gates:
```text
bun run test --filter @sverka/engine-native
bun run typecheck --filter @sverka/engine-native
bun run lint --filter @sverka/engine-native
bun run build --filter @sverka/engine-native
```

### Step 9: Adapt runtime-host

Delete old `host-executor.ts`. Write `host-driver.ts` implementing
RuntimeDriver. Reuse allowlist, errors. Write tests. Run gates.

### Step 10: Adapt runtime-docker

Delete old `docker-executor.ts`, `cache.ts`. Write `docker-driver.ts`
implementing RuntimeDriver. Reuse docker-cli, image, errors. Write tests.
Run gates.

### Step 11: Full gates

Run all three packages:
```text
bun run test --filter @sverka/engine-native --filter @sverka/runtime-host --filter @sverka/runtime-docker
bun run typecheck --filter @sverka/engine-native --filter @sverka/runtime-host --filter @sverka/runtime-docker
bun run lint --filter @sverka/engine-native --filter @sverka/runtime-host --filter @sverka/runtime-docker
bun run build --filter @sverka/engine-native --filter @sverka/runtime-host --filter @sverka/runtime-docker
```
