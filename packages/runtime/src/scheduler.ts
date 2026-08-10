import type { Plan, PlanOperation } from "@sverka/ir";
import type { Executor, ExecuteRequest, ExecuteResult } from "./executor.js";
import type { StateStore } from "./state-store.js";
import type { CacheBackend, CacheKey } from "./cache.js";
import type {
  ExecutionResult,
  OperationOutcome,
} from "./result.js";
import { SchedulerError, ExecutorError } from "./errors.js";
import { topoSort, dependentsOf } from "./internal/topo.js";
import { ResourcePool } from "./internal/resource-pool.js";
import { parseCpu, parseMemory } from "./internal/parse.js";

export interface SchedulerConfig {
  readonly executors: readonly Executor[];
  /** When set, the scheduler persists state for resume. */
  readonly stateStore?: StateStore;
  /** When set, the scheduler reuses cached results on a hit. */
  readonly cache?: CacheBackend;
  readonly maxConcurrent: number;
  /** When set, the scheduler enforces CPU limits via an internal pool. */
  readonly totalCpu?: number; // e.g. 8
  /** When set, the scheduler enforces memory limits via an internal pool. */
  readonly totalMemory?: string; // e.g. "16Gi"
  readonly workspace: string;
  readonly artifactDir: string;
  readonly cacheDir: string;
  readonly credentials: Readonly<Record<string, string>>;
  /** If true, resume from persisted state when available. */
  readonly resume: boolean;
}

interface OpState {
  readonly op: PlanOperation;
  status: OperationOutcome["status"] | "pending" | "running";
  outcome?: OperationOutcome;
}

/** Mutable shared state for a single execute() run. */
interface RunContext {
  readonly plan: Plan;
  readonly order: readonly string[];
  readonly states: Map<string, OpState>;
  readonly cancelledOps: Set<string>;
  readonly running: Set<string>;
  readonly skippedFromResume: Set<string>;
  readonly inflight: Set<Promise<void>>;
  index: number;
  fatalFailure: boolean;
  runError: SchedulerError | null;
  persistChain: Promise<void>;
}

/**
 * The Scheduler orchestrates execution of a Plan across one or more
 * Executors.
 */
export class Scheduler {
  private readonly config: SchedulerConfig;
  private readonly pool?: ResourcePool;
  private cancelled = false;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.validateConfig(config);
    // totalCpu and totalMemory are independent optionals: enforce whichever
    // is configured, treating an unset dimension as unbounded (Infinity).
    if (config.totalCpu !== undefined || config.totalMemory !== undefined) {
      this.pool = this.buildPool(config);
    }
  }

  private validateConfig(config: SchedulerConfig): void {
    // Validate maxConcurrent: must be a positive finite integer.
    if (
      typeof config.maxConcurrent !== "number" ||
      !Number.isFinite(config.maxConcurrent) ||
      config.maxConcurrent < 1 ||
      !Number.isInteger(config.maxConcurrent)
    ) {
      throw new SchedulerError(
        `maxConcurrent must be a positive integer (got ${String(config.maxConcurrent)})`,
        { code: "INVALID_CONFIG" },
      );
    }

    // Validate totalCpu: must be a positive finite number when provided.
    if (
      config.totalCpu !== undefined &&
      (typeof config.totalCpu !== "number" ||
        !Number.isFinite(config.totalCpu) ||
        config.totalCpu <= 0)
    ) {
      throw new SchedulerError(
        `totalCpu must be a positive finite number (got ${String(config.totalCpu)})`,
        { code: "INVALID_CONFIG" },
      );
    }
  }

  private buildPool(config: SchedulerConfig): ResourcePool {
    const cpu = config.totalCpu ?? Number.POSITIVE_INFINITY;
    const memory =
      config.totalMemory !== undefined
        ? parseMemory(config.totalMemory)
        : Number.POSITIVE_INFINITY;
    return new ResourcePool(cpu, memory);
  }

  /**
   * Execute the plan. Performs topological sort, runs independent operations
   * concurrently (up to maxConcurrent, and within optional CPU/memory
   * limits), cancels dependents on fatal failure, supports continueOnError,
   * optionally persists state, optionally reuses cache, honors retry policy,
   * and collects logs and artifacts.
   */
  async execute(plan: Plan): Promise<ExecutionResult> {
    this.cancelled = false;
    const start = Date.now();

    // Empty plan: defensive success.
    if (plan.operations.length === 0) {
      return this.emptyResult(plan);
    }

    // Cycle detection.
    const topo = topoSort(plan.operations);
    if (!topo.ok) {
      throw new SchedulerError("cycle detected in plan DAG", {
        code: "CYCLE_DETECTED",
        cycle: topo.cycle,
      });
    }

    // Resource feasibility check: any single op requesting more than the pool
    // total raises INSUFFICIENT_RESOURCES at scheduling time.
    this.checkResourceFeasibility(plan);

    // Resume: load prior state.
    const priorState = await this.loadState(plan.id);
    const completed = new Set<string>(priorState?.completed ?? []);
    // "running" ops from a prior interrupted run are re-run.
    const skippedFromResume = new Set<string>(completed);

    // Per-op state.
    const states = new Map<string, OpState>();
    for (const op of plan.operations) {
      states.set(op.id, { op, status: "pending" });
    }

    // Carry over prior outcomes for completed ops.
    this.applyPriorOutcomes(priorState, completed, states);

    const ctx: RunContext = {
      plan,
      order: topo.order,
      states,
      cancelledOps: new Set<string>(),
      running: new Set<string>(),
      skippedFromResume,
      inflight: new Set<Promise<void>>(),
      index: 0,
      fatalFailure: false,
      runError: null,
      persistChain: Promise.resolve(),
    };

    // Main scheduling loop: process ops in topological order, launching up to
    // maxConcurrent concurrently. Re-scan for newly-ready ops after each
    // completion.
    this.launchReady(ctx);
    await this.runMainLoop(ctx);

    // If a run-level error occurred, abort.
    if (ctx.runError) throw ctx.runError;

    // If cancelled, mark all running/pending as cancelled.
    if (this.cancelled) {
      this.cleanupCancelled(ctx);
    }

    // Drain any remaining inflight (they should be near-done after cancel).
    await Promise.allSettled(ctx.inflight);

    // Build the final result.
    const outcomes = this.buildOutcomes(ctx);
    const status = computeFinalStatus(
      this.cancelled,
      ctx.fatalFailure,
      outcomes,
    );

    // On fully successful completion, clear persisted state — it's no longer
    // needed for resume. On partial/failure/cancelled, retain it so a
    // subsequent resume run can pick up where this one left off.
    if (status === "success" && this.config.stateStore) {
      try {
        await this.config.stateStore.clear(plan.id);
      } catch (e) {
        // Best-effort: log and continue. Stale state is not a failure.
        console.warn("stateStore.clear failed:", e);
      }
    }

    return {
      planId: plan.id,
      status,
      outcomes,
      durationMs: Date.now() - start,
      cancelledOperations: [...ctx.cancelledOps],
    };
  }

  /** Cancel an in-progress execution. Resolves execute() with a partial result. */
  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  /** Dispose all executors that implement dispose(). */
  async dispose(): Promise<void> {
    for (const exec of this.config.executors) {
      if (typeof exec.dispose === "function") {
        try {
          await exec.dispose();
        } catch {
          // best-effort
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // execute() helpers
  // -------------------------------------------------------------------------

  private emptyResult(plan: Plan): ExecutionResult {
    return {
      planId: plan.id,
      status: "success",
      outcomes: new Map<string, OperationOutcome>(),
      durationMs: 0,
      cancelledOperations: [],
    };
  }

  private checkResourceFeasibility(plan: Plan): void {
    if (!this.pool) return;
    for (const op of plan.operations) {
      const cpu = parseCpu(op.resources.cpu);
      const memory = parseMemory(op.resources.memory);
      if (cpu > this.pool.cpu || memory > this.pool.memory) {
        throw new SchedulerError(
          `operation ${op.id} requests more resources than the pool total`,
          { code: "INSUFFICIENT_RESOURCES", operationId: op.id },
        );
      }
    }
  }

  private applyPriorOutcomes(
    priorState:
      | { completed: readonly string[]; outcomes: ReadonlyMap<string, OperationOutcome> }
      | undefined,
    completed: Set<string>,
    states: Map<string, OpState>,
  ): void {
    if (!priorState) return;
    for (const [id, outcome] of priorState.outcomes) {
      if (completed.has(id)) {
        const s = states.get(id);
        if (s) {
          s.status = "success";
          s.outcome = outcome;
        }
      }
    }
  }

  private async runMainLoop(ctx: RunContext): Promise<void> {
    while (
      ctx.inflight.size > 0 ||
      (ctx.index < ctx.order.length && !this.cancelled && !ctx.fatalFailure && !ctx.runError)
    ) {
      if (ctx.inflight.size === 0) {
        // No inflight but ops remain: either blocked or ready. Try launching.
        this.launchReady(ctx);
        if (ctx.inflight.size === 0) {
          // Nothing launchable (blocked by cancelled deps or done). Mark
          // remaining pending-but-cancelled and break.
          this.markBlockedAsCancelled(ctx);
          break;
        }
      }
      // Wait for at least one inflight to settle.
      await Promise.race(ctx.inflight);
      // If a run-level error occurred (e.g. NO_EXECUTOR), abort the run.
      if (ctx.runError) throw ctx.runError;
      if (!this.cancelled && !ctx.fatalFailure) this.launchReady(ctx);
    }
  }

  private markBlockedAsCancelled(ctx: RunContext): void {
    for (const id of ctx.order) {
      const s = ctx.states.get(id);
      if (s?.status === "pending" && !ctx.cancelledOps.has(id) && !ctx.skippedFromResume.has(id)) {
        // Blocked by a cancelled/failed dep => cancel it.
        ctx.cancelledOps.add(id);
        s.status = "cancelled";
        s.outcome = cancelledOutcome(id);
      }
    }
  }

  private cleanupCancelled(ctx: RunContext): void {
    for (const id of ctx.order) {
      const s = ctx.states.get(id);
      if (!s) continue;
      if (s.status === "running" || s.status === "pending") {
        ctx.cancelledOps.add(id);
        s.status = "cancelled";
        s.outcome = cancelledOutcome(id);
      }
    }
  }

  private buildOutcomes(ctx: RunContext): Map<string, OperationOutcome> {
    const outcomes = new Map<string, OperationOutcome>();
    for (const [id, s] of ctx.states) {
      if (s.outcome) outcomes.set(id, s.outcome);
    }
    return outcomes;
  }

  // -------------------------------------------------------------------------
  // Scheduling helpers
  // -------------------------------------------------------------------------

  /** Helper: mark an op and its transitive dependents as cancelled. */
  private cancelDependents(ctx: RunContext, id: string): void {
    const deps = dependentsOf(ctx.plan.operations, id);
    for (const d of deps) {
      if (ctx.cancelledOps.has(d)) continue;
      ctx.cancelledOps.add(d);
      const s = ctx.states.get(d);
      if (s?.status === "pending") {
        s.status = "cancelled";
        s.outcome = cancelledOutcome(d);
      }
    }
  }

  /** Helper: is an op ready to run? (all deps succeeded or skipped, not
   *  cancelled, not already done, not skipped-from-resume). */
  private isReady(ctx: RunContext, op: PlanOperation): boolean {
    const s = ctx.states.get(op.id);
    if (s?.status !== "pending") return false;
    if (ctx.cancelledOps.has(op.id)) return false;
    if (ctx.skippedFromResume.has(op.id)) return false;
    return op.dependsOn.every((dep) => {
      const ds = ctx.states.get(dep);
      return ds?.status === "success" || ds?.status === "skipped";
    });
  }

  /** Helper: persist state (best-effort, serialized to prevent overlap). */
  private persist(ctx: RunContext): Promise<void> {
    if (!this.config.stateStore) return Promise.resolve();
    // Serialize saves: chain onto the previous persist to prevent
    // concurrent StateStore.save() calls from overlapping or writing
    // out-of-order state.
    ctx.persistChain = ctx.persistChain.then(() => this.doPersist(ctx));
    return ctx.persistChain;
  }

  private async doPersist(ctx: RunContext): Promise<void> {
    const completedList: string[] = [];
    const failedList: string[] = [];
    const skippedList: string[] = [];
    const runningList: string[] = [];
    const outcomes = new Map<string, OperationOutcome>();
    for (const [id, s] of ctx.states) {
      if (s.outcome) outcomes.set(id, s.outcome);
      if (s.status === "success") completedList.push(id);
      else if (s.status === "failure") failedList.push(id);
      else if (s.status === "skipped") skippedList.push(id);
      else if (s.status === "running") runningList.push(id);
    }
    try {
      await this.config.stateStore!.save({
        planId: ctx.plan.id,
        completed: completedList,
        failed: failedList,
        skipped: skippedList,
        running: runningList,
        outcomes,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      // Best-effort: log and continue.
      console.warn("stateStore.save failed:", e);
    }
  }

  /**
   * Run a single op through cache check, executor selection, resource
   * acquisition, retry, and outcome recording.
   */
  private async runOp(ctx: RunContext, op: PlanOperation): Promise<void> {
    const s = ctx.states.get(op.id);
    if (!s) return;
    s.status = "running";
    ctx.running.add(op.id);

    try {
      // Cache check.
      if (await this.tryCacheHit(op, s)) return;

      // Executor selection — a SchedulerError here aborts the run.
      let executor: Executor;
      try {
        executor = this.selectExecutor(op);
      } catch (e) {
        if (e instanceof SchedulerError) {
          ctx.runError = e;
          s.status = "failure";
          s.outcome = {
            operationId: op.id,
            status: "failure",
            durationMs: 0,
            logs: "",
            artifacts: [],
            error: e.message,
            fromCache: false,
          };
        }
        return;
      }

      // Resource acquisition (wait if insufficient; abort on cancel).
      const acquired = await this.acquireResources(ctx, op, s);
      if (!acquired) return;

      try {
        // Retry loop.
        const outcome = await this.executeWithRetry(executor, op);
        s.status = outcome.status;
        s.outcome = outcome;

        // Track cancelled ops for the cancelledOperations list.
        if (outcome.status === "cancelled") {
          ctx.cancelledOps.add(op.id);
        }

        // Cache store on success.
        if (this.config.cache && op.cache && outcome.status === "success") {
          await this.storeCacheResult(op);
        }

        // Failure handling.
        if (outcome.status === "failure") {
          if (op.continueOnError) {
            // Cancel only this op's dependents; independent branches continue.
            this.cancelDependents(ctx, op.id);
          } else {
            ctx.fatalFailure = true;
            this.cancelDependents(ctx, op.id);
          }
        }
      } finally {
        if (this.pool) this.pool.release(acquired.cpu, acquired.memory);
      }
    } finally {
      ctx.running.delete(op.id);
      // Persist after each op completes (best-effort).
      await this.persist(ctx);
    }
  }

  /** Try a cache hit; returns true if the op was served from cache. */
  private async tryCacheHit(
    op: PlanOperation,
    s: OpState,
  ): Promise<boolean> {
    if (!this.config.cache || !op.cache) return false;
    const cacheKey: CacheKey = { key: op.cache.key, inputs: op.cache.inputs };
    try {
      const entry = await this.config.cache.get(cacheKey);
      if (!entry) return false;
      try {
        await this.config.cache.restore(cacheKey, this.config.workspace);
        s.status = "success";
        s.outcome = {
          operationId: op.id,
          status: "success",
          durationMs: 0,
          logs: "",
          artifacts: entry.outputs,
          fromCache: true,
        };
        return true;
      } catch {
        // restore failure => treat as miss, fall through to execute.
      }
    } catch {
      // cache.get failure => treat as miss.
    }
    return false;
  }

  /** Store a successful result in the cache (best-effort). */
  private async storeCacheResult(op: PlanOperation): Promise<void> {
    if (!this.config.cache || !op.cache) return;
    const cacheKey: CacheKey = { key: op.cache.key, inputs: op.cache.inputs };
    try {
      await this.config.cache.store(cacheKey, this.config.workspace);
      await this.config.cache.put({
        key: op.cache.key,
        outputs: op.cache.outputs,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // best-effort
    }
  }

  /**
   * Acquire resources from the pool, waiting if insufficient. Returns the
   * acquired amounts, or null if the op was cancelled while waiting.
   */
  private async acquireResources(
    ctx: RunContext,
    op: PlanOperation,
    s: OpState,
  ): Promise<{ cpu: number; memory: number } | null> {
    if (!this.pool) return { cpu: 0, memory: 0 };
    const cpu = parseCpu(op.resources.cpu);
    const memory = parseMemory(op.resources.memory);
    while (!this.pool.tryAcquire(cpu, memory)) {
      if (this.cancelled) {
        s.status = "cancelled";
        ctx.cancelledOps.add(op.id);
        s.outcome = cancelledOutcome(op.id);
        return null;
      }
      await sleep(5);
    }
    return { cpu, memory };
  }

  private launchReady(ctx: RunContext): void {
    while (ctx.running.size < this.config.maxConcurrent && ctx.index < ctx.order.length) {
      if (this.cancelled) break;
      // Find the next ready op in topological order.
      let found = false;
      for (let i = ctx.index; i < ctx.order.length; i++) {
        const id = ctx.order[i]!;
        const s = ctx.states.get(id);
        if (!s) continue;
        // Skip already-processed.
        if (s.status !== "pending") {
          if (i === ctx.index) ctx.index++;
          continue;
        }
        if (ctx.skippedFromResume.has(id)) {
          // Already succeeded via resume; advance.
          ctx.index = i + 1;
          continue;
        }
        if (ctx.cancelledOps.has(id)) {
          s.status = "cancelled";
          s.outcome = cancelledOutcome(id);
          if (i === ctx.index) ctx.index++;
          continue;
        }
        if (!this.isReady(ctx, s.op)) continue;
        // Launch it.
        ctx.index = i + 1;
        const p = this.runOp(ctx, s.op);
        ctx.inflight.add(p);
        // Use then with both handlers to avoid unhandled rejection from
        // finally's returned promise.
        p.then(
          () => ctx.inflight.delete(p),
          () => ctx.inflight.delete(p),
        );
        found = true;
        break;
      }
      if (!found) break;
    }
  }

  private selectExecutor(op: PlanOperation): Executor {
    for (const exec of this.config.executors) {
      if (exec.canExecute(op)) return exec;
    }
    throw new SchedulerError(`no executor for operation ${op.id}`, {
      code: "NO_EXECUTOR",
      operationId: op.id,
      executorType: op.executor.type,
    });
  }

  private async loadState(planId: string): Promise<
    | { completed: readonly string[]; outcomes: ReadonlyMap<string, OperationOutcome> }
    | undefined
  > {
    if (!this.config.stateStore || !this.config.resume) return undefined;
    let state;
    try {
      state = await this.config.stateStore.load(planId);
    } catch (e) {
      throw new SchedulerError("state store load failed", {
        code: "STATE_LOAD_ERROR",
        cause: e instanceof Error ? e.message : String(e),
      });
    }
    if (!state) return undefined;
    return { completed: state.completed, outcomes: state.outcomes };
  }

  private async executeWithRetry(
    executor: Executor,
    op: PlanOperation,
  ): Promise<OperationOutcome> {
    const { maxAttempts, backoffSeconds, retryOn } = op.retry;
    const start = Date.now();
    let lastResult: ExecuteResult | undefined;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.cancelled) {
        return cancelledOutcome(op.id, Date.now() - start);
      }

      const request: ExecuteRequest = {
        operation: op,
        workspace: this.config.workspace,
        env: op.env ?? {},
        credentials: this.config.credentials,
        cacheDir: this.config.cacheDir,
        artifactDir: this.config.artifactDir,
      };

      try {
        const result = await executor.execute(request);
        // If cancelled while the executor was running, override to cancelled.
        if (this.cancelled) {
          return cancelledOutcome(op.id, Date.now() - start);
        }
        lastResult = result;
        if (result.status === "success" || result.status === "skipped") {
          return toOutcome(op.id, result, false);
        }
        // Failure: decide whether to retry.
        const isTimeout = result.error?.includes("timeout") ?? false;
        if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
          return toOutcome(op.id, result, false);
        }
        // Backoff (cancellable).
        if (backoffSeconds > 0) {
          await cancellableSleep(backoffSeconds * 1000, this);
        }
      } catch (e) {
        // Executor threw: wrap in ExecutorError, record as failure.
        const wrapped = new ExecutorError(
          e instanceof Error ? e.message : String(e),
          { operationId: op.id, executor: executor.name },
        );
        lastError = wrapped;
        const isTimeout = e instanceof Error && e.message.includes("timeout");
        if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
          return failureOutcome(op.id, Date.now() - start, wrapped.message);
        }
        if (backoffSeconds > 0) {
          await cancellableSleep(backoffSeconds * 1000, this);
        }
      }
    }

    // Exhausted retries.
    if (lastResult) return toOutcome(op.id, lastResult, false);
    return failureOutcome(op.id, Date.now() - start, lastError?.message ?? "retries exhausted");
  }
}

// -------------------------------------------------------------------------
// Module-level helpers
// -------------------------------------------------------------------------

function shouldRetry(
  attempt: number,
  maxAttempts: number,
  retryOn: readonly ("failure" | "timeout")[],
  isTimeout: boolean,
): boolean {
  return (
    attempt < maxAttempts &&
    (retryOn.includes("failure") || (isTimeout && retryOn.includes("timeout")))
  );
}

function cancelledOutcome(opId: string, durationMs = 0): OperationOutcome {
  return {
    operationId: opId,
    status: "cancelled",
    durationMs,
    logs: "",
    artifacts: [],
    fromCache: false,
  };
}

function failureOutcome(
  opId: string,
  durationMs: number,
  error: string,
): OperationOutcome {
  return {
    operationId: opId,
    status: "failure",
    durationMs,
    logs: "",
    artifacts: [],
    error,
    fromCache: false,
  };
}

function toOutcome(
  opId: string,
  r: ExecuteResult,
  fromCache: boolean,
): OperationOutcome {
  return {
    operationId: opId,
    status: r.status,
    ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
    durationMs: r.durationMs,
    logs: r.logs,
    artifacts: r.artifacts,
    ...(r.error !== undefined ? { error: r.error } : {}),
    fromCache,
  };
}

function computeFinalStatus(
  cancelled: boolean,
  fatalFailure: boolean,
  outcomes: ReadonlyMap<string, OperationOutcome>,
): ExecutionResult["status"] {
  if (cancelled) return "partial";
  if (fatalFailure) return "failure";
  if (outcomesHaveFailureOrCancelled(outcomes)) return "partial";
  return "success";
}

function outcomesHaveFailureOrCancelled(
  outcomes: ReadonlyMap<string, OperationOutcome>,
): boolean {
  for (const o of outcomes.values()) {
    if (o.status === "failure" || o.status === "cancelled") return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancellableSleep(ms: number, scheduler: Scheduler): Promise<void> {
  const deadline = Date.now() + ms;
  // Poll every 10ms (or sooner) so cancel() is observed promptly.
  while (Date.now() < deadline) {
    // `cancelled` is private; access via a cast to a minimal shape.
    if ((scheduler as unknown as { cancelled: boolean }).cancelled) return;
    const wait = Math.min(10, deadline - Date.now());
    if (wait <= 0) return;
    await sleep(wait);
  }
}
