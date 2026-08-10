import type { Plan, PlanOperation } from "@sverka/ir";
import type { Executor, ExecuteRequest, ExecuteResult } from "./executor.js";
import type { StateStore } from "./state-store.js";
import type { CacheBackend, CacheKey } from "./cache.js";
import type { ExecutionResult, OperationOutcome } from "./result.js";
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
    // totalCpu and totalMemory are independent optionals: enforce whichever
    // is configured, treating an unset dimension as unbounded (Infinity).
    if (config.totalCpu !== undefined || config.totalMemory !== undefined) {
      const cpu = config.totalCpu ?? Number.POSITIVE_INFINITY;
      const memory =
        config.totalMemory !== undefined
          ? parseMemory(config.totalMemory)
          : Number.POSITIVE_INFINITY;
      this.pool = new ResourcePool(cpu, memory);
    }
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
      return {
        planId: plan.id,
        status: "success",
        outcomes: new Map<string, OperationOutcome>(),
        durationMs: 0,
        cancelledOperations: [],
      };
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
    if (this.pool) {
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
    if (priorState) {
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

    const cancelledOps = new Set<string>();
    const running = new Set<string>();
    let fatalFailure = false;

    // Helper: mark an op and its transitive dependents as cancelled.
    const cancelDependents = (id: string): void => {
      const deps = dependentsOf(plan.operations, id);
      for (const d of deps) {
        if (cancelledOps.has(d)) continue;
        cancelledOps.add(d);
        const s = states.get(d);
        if (s && s.status === "pending") {
          s.status = "cancelled";
          s.outcome = {
            operationId: d,
            status: "cancelled",
            durationMs: 0,
            logs: "",
            artifacts: [],
            fromCache: false,
          };
        }
      }
    };

    // Helper: is an op ready to run? (all deps succeeded or skipped, not
    // cancelled, not already done, not skipped-from-resume).
    const isReady = (op: PlanOperation): boolean => {
      const s = states.get(op.id);
      if (!s || s.status !== "pending") return false;
      if (cancelledOps.has(op.id)) return false;
      if (skippedFromResume.has(op.id)) return false;
      return op.dependsOn.every((dep) => {
        const ds = states.get(dep);
        return ds?.status === "success" || ds?.status === "skipped";
      });
    };

    // Helper: persist state (best-effort).
    const persist = async (): Promise<void> => {
      if (!this.config.stateStore) return;
      const completedList: string[] = [];
      const failedList: string[] = [];
      const skippedList: string[] = [];
      const runningList: string[] = [];
      const outcomes = new Map<string, OperationOutcome>();
      for (const [id, s] of states) {
        if (s.outcome) outcomes.set(id, s.outcome);
        if (s.status === "success") completedList.push(id);
        else if (s.status === "failure") failedList.push(id);
        else if (s.status === "skipped") skippedList.push(id);
        else if (s.status === "running") runningList.push(id);
      }
      try {
        await this.config.stateStore.save({
          planId: plan.id,
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
    };

    // A SchedulerError raised inside runOp (e.g. NO_EXECUTOR) that should
    // abort the entire run. Stored here and re-thrown from the main loop.
    let runError: SchedulerError | null = null;

    // Run a single op through cache check, executor selection, resource
    // acquisition, retry, and outcome recording.
    const runOp = async (op: PlanOperation): Promise<void> => {
      const s = states.get(op.id);
      if (!s) return;
      s.status = "running";
      running.add(op.id);

      try {
        // Cache check.
        if (this.config.cache && op.cache) {
          const cacheKey: CacheKey = {
            key: op.cache.key,
            inputs: op.cache.inputs,
          };
          try {
            const entry = await this.config.cache.get(cacheKey);
            if (entry) {
              try {
                await this.config.cache.restore(
                  cacheKey,
                  this.config.workspace,
                );
                s.status = "success";
                s.outcome = {
                  operationId: op.id,
                  status: "success",
                  durationMs: 0,
                  logs: "",
                  artifacts: entry.outputs,
                  fromCache: true,
                };
                return;
              } catch {
                // restore failure => treat as miss, fall through to execute.
              }
            }
          } catch {
            // cache.get failure => treat as miss.
          }
        }

        // Executor selection — a SchedulerError here aborts the run.
        let executor: Executor;
        try {
          executor = this.selectExecutor(op);
        } catch (e) {
          if (e instanceof SchedulerError) {
            runError = e;
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
        let acquiredCpu = 0;
        let acquiredMemory = 0;
        if (this.pool) {
          acquiredCpu = parseCpu(op.resources.cpu);
          acquiredMemory = parseMemory(op.resources.memory);
          while (!this.pool.tryAcquire(acquiredCpu, acquiredMemory)) {
            if (this.cancelled) {
              s.status = "cancelled";
              cancelledOps.add(op.id);
              s.outcome = {
                operationId: op.id,
                status: "cancelled",
                durationMs: 0,
                logs: "",
                artifacts: [],
                fromCache: false,
              };
              return;
            }
            await sleep(5);
          }
        }

        try {
          // Retry loop.
          const outcome = await this.executeWithRetry(executor, op);
          s.status = outcome.status;
          s.outcome = outcome;

          // Track cancelled ops for the cancelledOperations list.
          if (outcome.status === "cancelled") {
            cancelledOps.add(op.id);
          }

          // Cache store on success.
          if (this.config.cache && op.cache && outcome.status === "success") {
            const cacheKey: CacheKey = {
              key: op.cache.key,
              inputs: op.cache.inputs,
            };
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

          // Failure handling.
          if (outcome.status === "failure") {
            if (op.continueOnError) {
              // Cancel only this op's dependents; independent branches continue.
              cancelDependents(op.id);
            } else {
              fatalFailure = true;
              cancelDependents(op.id);
            }
          }
        } finally {
          if (this.pool) this.pool.release(acquiredCpu, acquiredMemory);
        }
      } finally {
        running.delete(op.id);
        // Persist after each op completes (best-effort).
        await persist();
      }
    };

    // Main scheduling loop: process ops in topological order, launching up to
    // maxConcurrent concurrently. Re-scan for newly-ready ops after each
    // completion.
    const order = topo.order;
    let index = 0;
    const inflight = new Set<Promise<void>>();

    const launchReady = (): void => {
      while (running.size < this.config.maxConcurrent && index < order.length) {
        if (this.cancelled) break;
        // Find the next ready op in topological order.
        let found = false;
        for (let i = index; i < order.length; i++) {
          const id = order[i]!;
          const s = states.get(id);
          if (!s) continue;
          // Skip already-processed.
          if (s.status !== "pending") {
            if (i === index) index++;
            continue;
          }
          if (skippedFromResume.has(id)) {
            // Already succeeded via resume; advance.
            index = i + 1;
            continue;
          }
          if (cancelledOps.has(id)) {
            s.status = "cancelled";
            s.outcome = {
              operationId: id,
              status: "cancelled",
              durationMs: 0,
              logs: "",
              artifacts: [],
              fromCache: false,
            };
            if (i === index) index++;
            continue;
          }
          if (!isReady(s.op)) continue;
          // Launch it.
          index = i + 1;
          const p = runOp(s.op);
          inflight.add(p);
          // Use then with both handlers to avoid unhandled rejection from
          // finally's returned promise.
          p.then(
            () => inflight.delete(p),
            () => inflight.delete(p),
          );
          found = true;
          break;
        }
        if (!found) break;
      }
    };

    // Mark resume-skipped ops as success in outcomes (already done above).
    // Process until all ops are handled or cancelled.
    launchReady();
    while (
      inflight.size > 0 ||
      (index < order.length && !this.cancelled && !fatalFailure && !runError)
    ) {
      if (inflight.size === 0) {
        // No inflight but ops remain: either blocked or ready. Try launching.
        launchReady();
        if (inflight.size === 0) {
          // Nothing launchable (blocked by cancelled deps or done). Mark
          // remaining pending-but-cancelled and break.
          for (const id of order) {
            const s = states.get(id);
            if (
              s &&
              s.status === "pending" &&
              !cancelledOps.has(id) &&
              !skippedFromResume.has(id)
            ) {
              // Blocked by a cancelled/failed dep => cancel it.
              cancelledOps.add(id);
              s.status = "cancelled";
              s.outcome = {
                operationId: id,
                status: "cancelled",
                durationMs: 0,
                logs: "",
                artifacts: [],
                fromCache: false,
              };
            }
          }
          break;
        }
      }
      // Wait for at least one inflight to settle.
      await Promise.race(inflight);
      // If a run-level error occurred (e.g. NO_EXECUTOR), abort the run.
      if (runError) throw runError;
      if (!this.cancelled && !fatalFailure) launchReady();
    }

    // If a run-level error occurred, abort.
    if (runError) throw runError;

    // If cancelled, mark all running/pending as cancelled.
    if (this.cancelled) {
      for (const id of order) {
        const s = states.get(id);
        if (!s) continue;
        if (s.status === "running" || s.status === "pending") {
          cancelledOps.add(id);
          s.status = "cancelled";
          s.outcome = {
            operationId: id,
            status: "cancelled",
            durationMs: 0,
            logs: "",
            artifacts: [],
            fromCache: false,
          };
        }
      }
    }

    // Drain any remaining inflight (they should be near-done after cancel).
    await Promise.allSettled(inflight);

    // Build the final result.
    const outcomes = new Map<string, OperationOutcome>();
    for (const [id, s] of states) {
      if (s.outcome) outcomes.set(id, s.outcome);
    }

    const status: ExecutionResult["status"] = this.cancelled
      ? "partial"
      : fatalFailure
        ? "failure"
        : outcomesHaveFailure(outcomes)
          ? "partial"
          : "success";

    return {
      planId: plan.id,
      status,
      outcomes,
      durationMs: Date.now() - start,
      cancelledOperations: [...cancelledOps],
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
    | {
        completed: readonly string[];
        outcomes: ReadonlyMap<string, OperationOutcome>;
      }
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
        return {
          operationId: op.id,
          status: "cancelled",
          durationMs: Date.now() - start,
          logs: "",
          artifacts: [],
          fromCache: false,
        };
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
          return {
            operationId: op.id,
            status: "cancelled",
            durationMs: Date.now() - start,
            logs: "",
            artifacts: [],
            fromCache: false,
          };
        }
        lastResult = result;
        if (result.status === "success" || result.status === "skipped") {
          return toOutcome(op.id, result, false);
        }
        // Failure: decide whether to retry.
        const isTimeout = result.error?.includes("timeout") ?? false;
        const shouldRetry =
          attempt < maxAttempts &&
          (retryOn.includes("failure") ||
            (isTimeout && retryOn.includes("timeout")));
        if (!shouldRetry) {
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
        const shouldRetry =
          attempt < maxAttempts &&
          (retryOn.includes("failure") ||
            (isTimeout && retryOn.includes("timeout")));
        if (!shouldRetry) {
          return {
            operationId: op.id,
            status: "failure",
            durationMs: Date.now() - start,
            logs: "",
            artifacts: [],
            error: wrapped.message,
            fromCache: false,
          };
        }
        if (backoffSeconds > 0) {
          await cancellableSleep(backoffSeconds * 1000, this);
        }
      }
    }

    // Exhausted retries.
    if (lastResult) return toOutcome(op.id, lastResult, false);
    return {
      operationId: op.id,
      status: "failure",
      durationMs: Date.now() - start,
      logs: "",
      artifacts: [],
      error: lastError?.message ?? "retries exhausted",
      fromCache: false,
    };
  }
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

function outcomesHaveFailure(
  outcomes: ReadonlyMap<string, OperationOutcome>,
): boolean {
  for (const o of outcomes.values()) {
    if (o.status === "failure") return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancellableSleep(
  ms: number,
  scheduler: Scheduler,
): Promise<void> {
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
