# Spec 03 — Runtime Package: Executor Interfaces and Scheduler

## Overview

The `runtime` package provides the executor interfaces and the scheduler that
drives execution of a canonical Plan. It is backend-agnostic: concrete
executors (`runtime-docker`, `runtime-podman`, `runtime-host`,
`runtime-remote`) implement the `Executor` interface, and the `Scheduler`
orchestrates them.

The scheduler performs a topological sort of the Plan DAG, executes
independent operations concurrently up to resource limits, prioritizes
critical checks, cancels dependents after fatal failures, supports
`continueOnError`, persists execution state for resumption, reuses cached
results, and collects logs and artifacts.

## Goals

1. Define the `Executor` interface with `canExecute` and `execute` methods.
2. Implement a `Scheduler` that:
   - Topologically sorts the Plan DAG.
   - Executes independent operations concurrently.
   - Respects CPU and memory limits via a resource pool.
   - Prioritizes critical checks (operations tagged `critical`) ahead of
     non-critical work when resources are contended.
   - Cancels dependents after a fatal failure (unless `continueOnError`).
   - Supports `continueOnError` per operation.
   - Persists execution state so interrupted runs can resume.
   - Reuses cache results when a cache key matches.
   - Collects logs and artifacts from every executed operation.
3. Provide a `SchedulerConfig` for concurrency, resource pool size, state
   persistence backend, and cache backend.
4. Export a stable result type (`ExecutionResult`) with per-operation outcomes.
5. Be fully backend-agnostic and testable with a mock executor.

## Non-goals

- Implementing concrete executors (handled by `runtime-docker`, etc.).
- Defining the Plan schema (handled by `ir`).
- Normalizing findings (handled by `findings`).
- Compiling to CI targets (handled by `compiler-*`).
- Distributed execution across multiple hosts (v1 is single-host).

## Interfaces

```typescript
// src/index.ts — public exports

export { type Executor, type ExecuteRequest, type ExecuteResult }
  from "./executor.js";
export { Scheduler, type SchedulerConfig }
  from "./scheduler.js";
export { type ExecutionResult, type OperationOutcome, type ExecutionState }
  from "./result.js";
export { type ResourcePool }
  from "./resource-pool.js";
export { type StateStore }
  from "./state-store.js";
export { type CacheBackend, type CacheKey, type CacheEntry }
  from "./cache.js";
export { RuntimeExecutionError, SchedulerError, ExecutorError }
  from "./errors.js";
```

```typescript
// src/executor.ts

import type { PlanOperation } from "@sverka/ir";

/**
 * A request to execute a single plan operation.
 */
export interface ExecuteRequest {
  readonly operation: PlanOperation;
  readonly workspace: string;          // path to mounted/available workspace
  readonly env: Readonly<Record<string, string>>;
  readonly credentials: Readonly<Record<string, string>>;
  readonly cacheDir: string;
  readonly artifactDir: string;
}

/**
 * The result of executing a single operation.
 */
export interface ExecuteResult {
  readonly operationId: string;
  readonly status: "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs: string;
  readonly artifacts: readonly string[];
  readonly error?: string;
}

/**
 * The Executor interface. Concrete executors (Docker, Podman, host, remote)
 * implement this. The scheduler queries `canExecute` to route operations.
 */
export interface Executor {
  readonly name: string;
  /** Return true if this executor can run the given operation. */
  canExecute(operation: PlanOperation): boolean;
  /** Execute the operation. Must respect timeout and resource limits. */
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  /** Optional cleanup when the scheduler shuts down. */
  dispose?(): Promise<void>;
}
```

```typescript
// src/resource-pool.ts

/**
 * A bounded pool of CPU and memory. The scheduler acquires and releases
 * units before and after each operation.
 */
export interface ResourcePool {
  readonly availableCpu: number;
  readonly availableMemory: number;
  /** Try to reserve resources. Returns false if insufficient. */
  tryAcquire(cpu: string, memory: string): boolean;
  /** Release previously acquired resources. */
  release(cpu: string, memory: string): void;
}
```

```typescript
// src/state-store.ts

/**
 * Persists execution state so an interrupted run can resume. Implementations
 * may use the filesystem, SQLite, or an in-memory mock for testing.
 */
export interface StateStore {
  save(state: ExecutionState): Promise<void>;
  load(planId: string): Promise<ExecutionState | undefined>;
  clear(planId: string): Promise<void>;
}
```

```typescript
// src/cache.ts

export interface CacheKey {
  readonly key: string;
  readonly inputs: readonly string[];
}

export interface CacheEntry {
  readonly key: string;
  readonly outputs: readonly string[];
  readonly createdAt: string;
}

/**
 * Cache backend for incremental execution. On a cache hit the scheduler
 * skips execution and restores outputs.
 */
export interface CacheBackend {
  get(key: CacheKey): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  restore(key: CacheKey, targetDir: string): Promise<void>;
  store(key: CacheKey, sourceDir: string): Promise<void>;
}
```

```typescript
// src/result.ts

import type { PlanOperation } from "@sverka/ir";

export interface OperationOutcome {
  readonly operationId: string;
  readonly status: "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs: string;
  readonly artifacts: readonly string[];
  readonly error?: string;
  readonly fromCache: boolean;
}

export interface ExecutionResult {
  readonly planId: string;
  readonly status: "success" | "failure" | "partial";
  readonly outcomes: ReadonlyMap<string, OperationOutcome>;
  readonly durationMs: number;
  readonly cancelledOperations: readonly string[];
}

export interface ExecutionState {
  readonly planId: string;
  readonly completed: readonly string[];
  readonly failed: readonly string[];
  readonly skipped: readonly string[];
  readonly running: readonly string[];
  readonly outcomes: ReadonlyMap<string, OperationOutcome>;
  readonly updatedAt: string;
}
```

```typescript
// src/scheduler.ts

import type { Plan } from "@sverka/ir";
import type { Executor } from "./executor.js";
import type { StateStore } from "./state-store.js";
import type { CacheBackend } from "./cache.js";
import type { ExecutionResult } from "./result.js";

export interface SchedulerConfig {
  readonly executors: readonly Executor[];
  readonly stateStore: StateStore;
  readonly cache: CacheBackend;
  readonly maxConcurrent: number;
  readonly totalCpu: number;            // e.g. 8
  readonly totalMemory: string;         // e.g. "16Gi"
  readonly workspace: string;
  readonly artifactDir: string;
  readonly cacheDir: string;
  readonly credentials: Readonly<Record<string, string>>;
  /** If true, resume from persisted state when available. */
  readonly resume: boolean;
}

/**
 * The Scheduler orchestrates execution of a Plan across one or more
 * Executors.
 */
export class Scheduler {
  constructor(config: SchedulerConfig);

  /**
   * Execute the plan. Performs topological sort, runs independent operations
   * concurrently, respects resource limits, prioritizes critical checks,
   * cancels dependents on fatal failure, supports continueOnError, persists
   * state, reuses cache, and collects logs and artifacts.
   */
  execute(plan: Plan): Promise<ExecutionResult>;

  /** Cancel an in-progress execution. */
  cancel(): Promise<void>;

  /** Dispose all executors. */
  dispose(): Promise<void>;
}
```

## Data models

```
Scheduler
 ├─ config: SchedulerConfig
 │    ├─ executors: Executor[]
 │    ├─ stateStore: StateStore
 │    ├─ cache: CacheBackend
 │    ├─ maxConcurrent, totalCpu, totalMemory
 │    ├─ workspace, artifactDir, cacheDir
 │    ├─ credentials: Record<string, string>
 │    └─ resume: boolean
 │
 ├─ ResourcePool (cpu + memory units)
 │
 └─ Execution loop:
      1. Load persisted state (if resume=true and state exists).
      2. Topological sort of remaining operations.
      3. For each ready operation (all deps satisfied):
           a. Check cache → hit: restore outputs, mark success, fromCache=true.
           b. Select executor via canExecute().
           c. Acquire resources from pool (respect cpu/memory).
              - Critical-tagged ops prioritized when pool is contended.
           d. Execute with timeout and retry policy.
           e. Collect logs + artifacts.
           f. Release resources.
           g. Persist state.
      4. On fatal failure (status=failure, continueOnError=false):
           - Cancel all dependents (transitive).
           - Mark them status=cancelled.
      5. On failure with continueOnError=true:
           - Continue executing independent branches.
      6. Return ExecutionResult.

ExecutionResult
 ├─ planId, status, durationMs
 ├─ outcomes: Map<operationId, OperationOutcome>
 │    ├─ status: success|failure|skipped|cancelled
 │    ├─ exitCode, durationMs, logs, artifacts
 │    ├─ fromCache: boolean
 │    └─ error?: string
 └─ cancelledOperations: string[]
```

## Error handling

All errors extend `RuntimeExecutionError`.

```typescript
// src/errors.ts

export class RuntimeExecutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeExecutionError";
  }
}

/** Raised when the scheduler cannot proceed (e.g. no executor for an op). */
export class SchedulerError extends RuntimeExecutionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SCHEDULER_ERROR", context);
    this.name = "SchedulerError";
  }
}

/** Wraps failures raised by an Executor. */
export class ExecutorError extends RuntimeExecutionError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "EXECUTOR_ERROR", context);
    this.name = "ExecutorError";
  }
}
```

Rules:

1. **No executor for an operation.** If no registered executor returns
   `canExecute(op) === true`, a `SchedulerError` with code `NO_EXECUTOR` is
   raised, including the operation id and executor type in `context`.
2. **Cycle in plan.** If the plan DAG contains a cycle, a `SchedulerError`
   with code `CYCLE_DETECTED` is raised. (The IR validator should catch this
   first, but the scheduler defends in depth.)
3. **Executor failure.** An executor that throws is wrapped in
   `ExecutorError`; the operation outcome is recorded as `failure` and the
   scheduler proceeds according to `continueOnError`.
4. **Timeout.** If an operation exceeds `timeoutSeconds`, the executor must
   return `status: "failure"` with an error message; the scheduler applies the
   retry policy.
5. **Resource exhaustion.** If the resource pool cannot satisfy an operation,
   it waits; it is not an error. If `totalCpu`/`totalMemory` are smaller than
   any single operation's request, a `SchedulerError` with code
   `INSUFFICIENT_RESOURCES` is raised at scheduling time.
6. **State store failure.** If `stateStore.save` throws, the scheduler logs
   the error and continues (state persistence is best-effort, not fatal). If
   `stateStore.load` throws on resume, a `SchedulerError` with code
   `STATE_LOAD_ERROR` is raised.
7. **Cancellation.** `cancel()` marks running operations as `cancelled` and
   resolves `execute()` with a `partial` result.

## Test plan

Tests live in `packages/runtime/src/__tests__/` and run via `bun test`.

1. **Topological scheduling**
   - A linear plan `a → b → c` executes in order.
   - A diamond plan `a → {b, c} → d` executes `b` and `c` concurrently after
     `a`, then `d`.
   - Independent operations with no shared deps run concurrently.

2. **Resource limits**
   - Two operations each requesting 4 CPU on a 4-CPU pool run sequentially.
   - Two operations each requesting 2 CPU on a 4-CPU pool run concurrently.
   - An operation requesting more CPU than `totalCpu` raises
     `INSUFFICIENT_RESOURCES`.

3. **Critical check prioritization**
   - When the pool has room for one operation and both a critical and a
     non-critical op are ready, the critical op is scheduled first.

4. **Failure and cancellation**
   - A fatal failure on `a` cancels `b` and `c` (dependents) with
     `status: "cancelled"`.
   - `continueOnError: true` on `a` allows `b` (independent branch) to
     proceed; dependents of `a` are still cancelled.
   - `cancel()` during execution produces a `partial` result.

5. **Cache reuse**
   - An operation with a matching cache key is not executed; its outcome has
     `fromCache: true` and `status: "success"`.
   - A cache miss executes the operation and stores outputs.

6. **State persistence and resume**
   - After executing `a` and `b`, the state store contains both as completed.
   - A resumed run skips `a` and `b` and executes only remaining operations.
   - A `stateStore.load` failure on resume raises `STATE_LOAD_ERROR`.

7. **Executor routing**
   - A mock Docker executor returns `canExecute` true only for docker-type
     operations; the scheduler routes accordingly.
   - An operation with no matching executor raises `NO_EXECUTOR`.

8. **Logs and artifacts**
   - Every executed operation has `logs` and `artifacts` collected in its
     outcome.

9. **Retry policy**
   - An operation with `maxAttempts: 3` that fails twice then succeeds has
     `status: "success"`.
   - An operation that fails all attempts has `status: "failure"`.

10. **Type safety**
    - `bun run typecheck` passes with `strict: true` and no `any` types.

11. **Commands**
    ```bash
    bun test packages/runtime
    bun run typecheck
    bun run lint
    ```
