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
import {
  cancelledOutcome,
  failureOutcome,
  toOutcome,
  shouldRetry,
  computeFinalStatus,
  sleep,
  cancellableSleep,
} from "./internal/scheduler-helpers.js";

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
    if (config.totalCpu !== undefined || config.totalMemory !== undefined) {
      this.pool = this.buildPool(config);
    }
  }

  private validateConfig(config: SchedulerConfig): void {
    this.validateMaxConcurrent(config);
    this.validateTotalCpu(config);
  }

  private validateMaxConcurrent(config: SchedulerConfig): void {
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
  }

  private validateTotalCpu(config: SchedulerConfig): void {
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
    if (plan.operations.length === 0) return this.emptyResult(plan);

    const topo = topoSort(plan.operations);
    if (!topo.ok) {
      throw new SchedulerError("cycle detected in plan DAG", {
        code: "CYCLE_DETECTED",
        cycle: topo.cycle,
      });
    }

    this.checkResourceFeasibility(plan);
    const ctx = await this.prepareContext(plan, topo);

    this.launchReady(ctx);
    await this.runMainLoop(ctx);
    if (ctx.runError) throw ctx.runError;
    if (this.cancelled) this.cleanupCancelled(ctx);

    await Promise.allSettled(ctx.inflight);
    return this.finalizeResult(ctx, start);
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

  private async prepareContext(
    plan: Plan,
    topo: { ok: true; order: readonly string[] },
  ): Promise<RunContext> {
    const priorState = await this.loadState(plan.id);
    const completed = new Set<string>(priorState?.completed ?? []);
    const skippedFromResume = new Set<string>(completed);
    const states = new Map<string, OpState>();
    for (const op of plan.operations) {
      states.set(op.id, { op, status: "pending" });
    }
    this.applyPriorOutcomes(priorState, completed, states);
    return {
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
      if (!completed.has(id)) continue;
      const s = states.get(id);
      if (s) {
        s.status = "success";
        s.outcome = outcome;
      }
    }
  }

  private async runMainLoop(ctx: RunContext): Promise<void> {
    while (this.shouldContinue(ctx)) {
      if (ctx.inflight.size === 0) {
        this.launchReady(ctx);
        if (ctx.inflight.size === 0) {
          this.markBlockedAsCancelled(ctx);
          break;
        }
      }
      await Promise.race(ctx.inflight);
      if (ctx.runError) throw ctx.runError;
      if (!this.cancelled && !ctx.fatalFailure) this.launchReady(ctx);
    }
  }

  private shouldContinue(ctx: RunContext): boolean {
    return (
      ctx.inflight.size > 0 ||
      (ctx.index < ctx.order.length && !this.cancelled && !ctx.fatalFailure && !ctx.runError)
    );
  }

  private markBlockedAsCancelled(ctx: RunContext): void {
    for (const id of ctx.order) {
      const s = ctx.states.get(id);
      if (this.isBlockedPending(ctx, id, s)) {
        ctx.cancelledOps.add(id);
        s.status = "cancelled";
        s.outcome = cancelledOutcome(id);
      }
    }
  }

  private isBlockedPending(
    ctx: RunContext,
    id: string,
    s: OpState | undefined,
  ): s is OpState {
    if (!s) return false;
    if (s.status !== "pending") return false;
    if (ctx.cancelledOps.has(id)) return false;
    return !ctx.skippedFromResume.has(id);
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

  private async finalizeResult(
    ctx: RunContext,
    start: number,
  ): Promise<ExecutionResult> {
    const outcomes = this.buildOutcomes(ctx);
    const status = computeFinalStatus(this.cancelled, ctx.fatalFailure, outcomes);
    await this.maybeClearState(ctx.plan.id, status);
    return {
      planId: ctx.plan.id,
      status,
      outcomes,
      durationMs: Date.now() - start,
      cancelledOperations: [...ctx.cancelledOps],
    };
  }

  private async maybeClearState(
    planId: string,
    status: ExecutionResult["status"],
  ): Promise<void> {
    if (status !== "success" || !this.config.stateStore) return;
    try {
      await this.config.stateStore.clear(planId);
    } catch (e) {
      console.warn("stateStore.clear failed:", e);
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

  private persist(ctx: RunContext): Promise<void> {
    if (!this.config.stateStore) return Promise.resolve();
    ctx.persistChain = ctx.persistChain.then(() => this.doPersist(ctx));
    return ctx.persistChain;
  }

  private async doPersist(ctx: RunContext): Promise<void> {
    const snapshot = this.snapshotState(ctx);
    try {
      await this.config.stateStore!.save({
        planId: ctx.plan.id,
        ...snapshot,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("stateStore.save failed:", e);
    }
  }

  private snapshotState(ctx: RunContext): {
    completed: string[];
    failed: string[];
    skipped: string[];
    running: string[];
    outcomes: Map<string, OperationOutcome>;
  } {
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
    return { completed: completedList, failed: failedList, skipped: skippedList, running: runningList, outcomes };
  }

  private async runOp(ctx: RunContext, op: PlanOperation): Promise<void> {
    const s = ctx.states.get(op.id);
    if (!s) return;
    s.status = "running";
    ctx.running.add(op.id);
    try {
      if (await this.tryCacheHit(op, s)) return;
      const executor = this.selectExecutorSafe(ctx, op, s);
      if (!executor) return;
      const acquired = await this.acquireResources(ctx, op, s);
      if (!acquired) return;
      try {
        await this.runOpAttempt(ctx, op, s, executor);
      } finally {
        if (this.pool) this.pool.release(acquired.cpu, acquired.memory);
      }
    } finally {
      ctx.running.delete(op.id);
      await this.persist(ctx);
    }
  }

  private selectExecutorSafe(
    ctx: RunContext,
    op: PlanOperation,
    s: OpState,
  ): Executor | null {
    try {
      return this.selectExecutor(op);
    } catch (e) {
      if (e instanceof SchedulerError) {
        ctx.runError = e;
        s.status = "failure";
        s.outcome = failureOutcome(op.id, 0, e.message);
      }
      return null;
    }
  }

  private async runOpAttempt(
    ctx: RunContext,
    op: PlanOperation,
    s: OpState,
    executor: Executor,
  ): Promise<void> {
    const outcome = await this.executeWithRetry(executor, op);
    s.status = outcome.status;
    s.outcome = outcome;
    if (outcome.status === "cancelled") ctx.cancelledOps.add(op.id);
    if (outcome.status === "success" && this.config.cache && op.cache) {
      await this.storeCacheResult(op);
    }
    if (outcome.status === "failure") this.handleOpFailure(ctx, op);
  }

  private handleOpFailure(ctx: RunContext, op: PlanOperation): void {
    if (!op.continueOnError) ctx.fatalFailure = true;
    this.cancelDependents(ctx, op.id);
  }

  private async tryCacheHit(op: PlanOperation, s: OpState): Promise<boolean> {
    if (!this.config.cache || !op.cache) return false;
    const cacheKey: CacheKey = { key: op.cache.key, inputs: op.cache.inputs };
    try {
      const entry = await this.config.cache.get(cacheKey);
      if (!entry) return false;
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
      return false;
    }
  }

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
      if (!this.tryLaunchNextReady(ctx)) break;
    }
  }

  private tryLaunchNextReady(ctx: RunContext): boolean {
    for (let i = ctx.index; i < ctx.order.length; i++) {
      const id = ctx.order[i]!;
      const s = ctx.states.get(id);
      if (!s) continue;
      if (s.status !== "pending") {
        if (i === ctx.index) ctx.index++;
        continue;
      }
      if (ctx.skippedFromResume.has(id)) {
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
      ctx.index = i + 1;
      const p = this.runOp(ctx, s.op);
      ctx.inflight.add(p);
      p.then(
        () => ctx.inflight.delete(p),
        () => ctx.inflight.delete(p),
      );
      return true;
    }
    return false;
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
      if (this.cancelled) return cancelledOutcome(op.id, Date.now() - start);
      const request = this.buildRequest(op);
      const result = await this.executeAttempt(
        executor, op, request, attempt, maxAttempts, retryOn, backoffSeconds, start,
      );
      if (result.outcome) return result.outcome;
      if (result.lastResult) lastResult = result.lastResult;
      if (result.lastError) lastError = result.lastError;
    }
    if (lastResult) return toOutcome(op.id, lastResult, false);
    return failureOutcome(op.id, Date.now() - start, lastError?.message ?? "retries exhausted");
  }

  private buildRequest(op: PlanOperation): ExecuteRequest {
    return {
      operation: op,
      workspace: this.config.workspace,
      env: op.env ?? {},
      credentials: this.config.credentials,
      cacheDir: this.config.cacheDir,
      artifactDir: this.config.artifactDir,
    };
  }

  private async executeAttempt(
    executor: Executor,
    op: PlanOperation,
    request: ExecuteRequest,
    attempt: number,
    maxAttempts: number,
    retryOn: readonly ("failure" | "timeout")[],
    backoffSeconds: number,
    start: number,
  ): Promise<{ outcome?: OperationOutcome; lastResult?: ExecuteResult; lastError?: Error }> {
    try {
      const result = await executor.execute(request);
      if (this.cancelled) return { outcome: cancelledOutcome(op.id, Date.now() - start) };
      if (result.status === "success" || result.status === "skipped") {
        return { outcome: toOutcome(op.id, result, false) };
      }
      const isTimeout = result.error?.includes("timeout") ?? false;
      if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
        return { outcome: toOutcome(op.id, result, false) };
      }
      if (backoffSeconds > 0) await cancellableSleep(backoffSeconds * 1000, this);
      return { lastResult: result };
    } catch (e) {
      return this.handleExecutorThrow(
        executor, op, e, attempt, maxAttempts, retryOn, backoffSeconds, start,
      );
    }
  }

  private async handleExecutorThrow(
    executor: Executor,
    op: PlanOperation,
    e: unknown,
    attempt: number,
    maxAttempts: number,
    retryOn: readonly ("failure" | "timeout")[],
    backoffSeconds: number,
    start: number,
  ): Promise<{ outcome?: OperationOutcome; lastError?: Error }> {
    const wrapped = new ExecutorError(
      e instanceof Error ? e.message : String(e),
      { operationId: op.id, executor: executor.name },
    );
    const isTimeout = e instanceof Error && e.message.includes("timeout");
    if (!shouldRetry(attempt, maxAttempts, retryOn, isTimeout)) {
      return { outcome: failureOutcome(op.id, Date.now() - start, wrapped.message) };
    }
    if (backoffSeconds > 0) await cancellableSleep(backoffSeconds * 1000, this);
    return { lastError: wrapped };
  }
}
