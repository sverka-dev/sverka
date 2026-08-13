// Engine — the native engine. Spec 10 — §21, §22.
// Consumes a RunPlan, schedules the Step DAG, executes via runtime drivers,
// emits structured run events, supports cancellation.

import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RunPlan } from "@sverka/ir";
import type { StepDefinition } from "@sverka/core";
import type {
  Engine,
  RunRequest,
  RunEvent,
  ValueStore,
  SecretProvider,
  EngineConfig,
  RuntimeDriver,
  ArtifactStore,
} from "./types.js";
import { createValueStore } from "./value-store.js";
import { createArtifactStore } from "./artifact-store.js";
import { executeStep, type StepExecOptions } from "./step-executor.js";
import { buildStepExecutionGraph, transitiveDependents, type StepState, type StepGraph } from "./scheduler.js";
import { stepPrefix } from "./refs.js";

/** Create a native engine with the given drivers. */
export function createEngine(config: EngineConfig): Engine {
  return new NativeEngine(config);
}

interface RunContext {
  readonly request: RunRequest;
  readonly runId: string;
  readonly start: number;
  readonly abort: AbortController;
  readonly plan: RunPlan;
  readonly drivers: readonly RuntimeDriver[];
  readonly maxConcurrent: number;
  readonly order: readonly string[];
  readonly stepMap: Map<string, StepDefinition>;
  readonly dependents: Map<string, string[]>;
  indegree: Map<string, number>;
  readonly states: Map<string, StepState>;
  readonly valueStore: ValueStore;
  readonly artifactStore: ArtifactStore;
  readonly secrets: Readonly<Record<string, string>>;
  readonly eventQueue: RunEvent[];
  readonly readyQueue: string[];
  hasFailure: boolean;
  emit(event: RunEvent): void;
}

class NativeEngine implements Engine {
  private readonly config: EngineConfig;
  private activeRun: AbortController | undefined = undefined;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const runId = randomUUID();
    const start = Date.now();

    if (this.activeRun && !this.activeRun.signal.aborted) {
      yield { type: "run-started", runId, planId: request.plan.id };
      yield {
        type: "diagnostic",
        stepId: "",
        message: "another run is already active on this engine instance",
        severity: "error",
      };
      yield {
        type: "run-completed",
        runId,
        status: "failure",
        durationMs: Date.now() - start,
      };
      return;
    }

    const abort = new AbortController();
    const thisRun = abort;
    this.activeRun = abort;
    try {
      yield* this.executeRun(request, runId, start, abort);
    } finally {
      if (this.activeRun === thisRun) {
        this.activeRun = undefined;
      }
    }
  }

  cancel(): Promise<void> {
    this.activeRun?.abort();
    return Promise.resolve();
  }

  private async *executeRun(
    request: RunRequest,
    runId: string,
    start: number,
    abort: AbortController,
  ): AsyncGenerator<RunEvent, void, void> {
    yield { type: "run-started", runId, planId: request.plan.id };

    const setup = yield* this.prepareRun(request, runId, start, abort);
    if (setup === null) return;

    const ctx: RunContext = {
      ...setup,
      eventQueue: [],
      readyQueue: [],
      hasFailure: false,
      emit: () => undefined,
    };

    class Deferred {
      promise: Promise<void>;
      resolve!: () => void;
      constructor() {
        this.promise = new Promise((r) => {
          this.resolve = r;
        });
      }
    }
    const eventDeferred = { current: new Deferred() };

    ctx.emit = (event: RunEvent): void => {
      ctx.eventQueue.push(event);
      eventDeferred.current.resolve();
      eventDeferred.current = new Deferred();
    };

    for (const s of setup.plan.steps) {
      ctx.emit({ type: "step-pending", stepId: s.id });
    }
    for (const id of setup.order) {
      if ((setup.indegree.get(id) ?? 0) === 0) ctx.readyQueue.push(id);
    }
    yield* this.drainEvents(ctx);

    yield* this.runSchedule(ctx, eventDeferred);
    yield* this.drainEvents(ctx);

    const status = this.isCancelled(ctx.abort)
      ? "cancelled"
      : ctx.hasFailure
        ? "failure"
        : "success";
    yield {
      type: "run-completed",
      runId,
      status,
      durationMs: Date.now() - start,
    };
  }

  private async *prepareRun(
    request: RunRequest,
    runId: string,
    start: number,
    abort: AbortController,
  ): AsyncGenerator<RunEvent, Omit<RunContext, "eventQueue" | "readyQueue" | "hasFailure" | "emit"> | null, void> {
    const plan = request.plan;
    const drivers = request.drivers ?? this.config.drivers;
    const maxConcurrent = request.maxConcurrent ?? this.config.maxConcurrent ?? 4;

    const setup = await this.resolveSetup(request, plan);
    if (setup.error) {
      yield* this.emitSetupFailure(runId, start, setup.error);
      return null;
    }

    const states = new Map<string, StepState>();
    for (const id of setup.graph.order) states.set(id, "pending");

    return {
      request,
      runId,
      start,
      abort,
      plan,
      drivers,
      maxConcurrent,
      order: setup.graph.order,
      stepMap: setup.graph.stepMap,
      dependents: setup.graph.dependents,
      indegree: setup.graph.indegree,
      states,
      valueStore: createValueStore(),
      artifactStore: createArtifactStore(request.artifactDir),
      secrets: setup.secrets,
    };
  }

  private async resolveSetup(
    request: RunRequest,
    plan: RunPlan,
  ): Promise<{ error: string | null; graph: StepGraph; secrets: Record<string, string> }> {
    const secretsResult = await resolveRunSecrets(request, plan);
    if (secretsResult.error) {
      return { error: secretsResult.error, graph: emptyGraph(), secrets: {} };
    }

    const graphResult = buildStepGraph(plan.steps);
    if (graphResult.error) {
      return { error: graphResult.error, graph: emptyGraph(), secrets: {} };
    }

    const wsError = await ensureWorkspace(request.workspace);
    if (wsError) {
      return { error: wsError, graph: emptyGraph(), secrets: {} };
    }

    return { error: null, graph: graphResult.graph, secrets: secretsResult.secrets };
  }

  private *emitSetupFailure(
    runId: string,
    start: number,
    message: string,
  ): Generator<RunEvent, void, void> {
    yield {
      type: "diagnostic",
      stepId: "",
      message,
      severity: "error",
    };
    yield {
      type: "run-completed",
      runId,
      status: "failure",
      durationMs: Date.now() - start,
    };
  }

  private async *runSchedule(
    ctx: RunContext,
    eventDeferred: { current: { promise: Promise<void>; resolve: () => void } },
  ): AsyncGenerator<RunEvent, void, void> {
    const running = new Map<Promise<void>, string>();
    const waitForEvent = (): Promise<void> => eventDeferred.current.promise;

    const launch = (): void => {
      while (
        running.size < ctx.maxConcurrent &&
        ctx.readyQueue.length > 0 &&
        !this.isCancelled(ctx.abort)
      ) {
        const id = ctx.readyQueue.shift()!;
        const step = ctx.stepMap.get(id)!;

        if (step.condition && !this.evaluateCondition(step.condition, ctx, step.id)) {
          ctx.states.set(id, "skipped");
          ctx.emit({ type: "step-skipped", stepId: id });
          this.onStepComplete(ctx, id);
          continue;
        }

        const driver = ctx.drivers.find((d) => d.canExecute(step));
        if (!driver) {
          ctx.states.set(id, "failed");
          ctx.emit({
            type: "step-failed",
            stepId: id,
            error: `no runtime driver can execute step '${id}'`,
            durationMs: 0,
          });
          ctx.hasFailure = true;
          this.cancelDependents(ctx, id);
          continue;
        }

        ctx.states.set(id, "running");
        ctx.emit({ type: "step-ready", stepId: id });
        ctx.emit({ type: "step-started", stepId: id });

        const promise = this.runStep(ctx, step, driver);
        running.set(promise, id);
        promise.then(
          () => running.delete(promise),
          () => running.delete(promise),
        );
      }
    };

    launch();
    yield* this.drainEvents(ctx);

    while (running.size > 0 || ctx.readyQueue.length > 0) {
      if (this.isCancelled(ctx.abort)) {
        for (const id of ctx.order) {
          if (ctx.states.get(id) === "pending") {
            ctx.states.set(id, "cancelled");
            ctx.emit({ type: "step-cancelled", stepId: id });
          }
        }
        yield* this.drainEvents(ctx);
        await Promise.allSettled(running.keys());
        break;
      }

      if (ctx.readyQueue.length > 0 && running.size < ctx.maxConcurrent) {
        launch();
        yield* this.drainEvents(ctx);
        continue;
      }

      const waiters: Promise<void>[] = [...running.keys()];
      if (running.size > 0) {
        waiters.push(waitForEvent());
      } else {
        break;
      }

      await Promise.race(waiters);
      yield* this.drainEvents(ctx);
      launch();
      yield* this.drainEvents(ctx);
    }
  }

  private async runStep(
    ctx: RunContext,
    step: StepDefinition,
    driver: RuntimeDriver,
  ): Promise<void> {
    const result = await executeStep(this.buildStepExecOptions(ctx, step, driver));

    if (result.status === "succeeded") {
      ctx.states.set(step.id, "succeeded");
      ctx.emit({
        type: "step-succeeded",
        stepId: step.id,
        durationMs: result.durationMs,
      });
      this.onStepComplete(ctx, step.id);
    } else if (result.status === "failed") {
      ctx.states.set(step.id, "failed");
      ctx.emit({
        type: "step-failed",
        stepId: step.id,
        error: result.error ?? "unknown",
        durationMs: result.durationMs,
      });
      ctx.hasFailure = true;
      this.cancelDependents(ctx, step.id);
    } else if (result.status === "cancelled") {
      ctx.states.set(step.id, "cancelled");
      ctx.emit({ type: "step-cancelled", stepId: step.id });
      this.cancelDependents(ctx, step.id);
    }
  }

  private buildStepExecOptions(
    ctx: RunContext,
    step: StepDefinition,
    driver: RuntimeDriver,
  ): StepExecOptions {
    return {
      step,
      driver,
      workspace: ctx.request.workspace,
      artifactStore: ctx.artifactStore,
      valueStore: ctx.valueStore,
      secrets: ctx.secrets,
      inputs: ctx.plan.inputs,
      emit: ctx.emit,
      isCancelled: () => this.isCancelled(ctx.abort),
      signal: ctx.abort.signal,
    };
  }

  private onStepComplete(ctx: RunContext, id: string): void {
    for (const depId of ctx.dependents.get(id) ?? []) {
      if (ctx.states.get(depId) !== "pending") continue;
      const next = (ctx.indegree.get(depId) ?? 0) - 1;
      ctx.indegree.set(depId, next);
      if (next === 0) {
        ctx.readyQueue.push(depId);
      }
    }
  }

  private cancelDependents(ctx: RunContext, id: string): void {
    for (const depId of transitiveDependents(ctx.plan.steps, id)) {
      if (ctx.states.get(depId) === "pending") {
        ctx.states.set(depId, "cancelled");
        ctx.emit({ type: "step-cancelled", stepId: depId });
      }
    }
  }

  private *drainEvents(ctx: RunContext): Generator<RunEvent, void, void> {
    while (ctx.eventQueue.length > 0) {
      yield ctx.eventQueue.shift()!;
    }
  }

  private isCancelled(abort: AbortController): boolean {
    return abort.signal.aborted;
  }

  private evaluateCondition(
    condition: NonNullable<StepDefinition["condition"]>,
    ctx: RunContext,
    stepId: string,
  ): boolean {
    if (condition.kind === "context") {
      const key = `${condition.namespace}.${condition.field}`;
      const value = ctx.plan.inputs?.[key] ?? ctx.plan.inputs?.[condition.field];
      return value !== undefined && value !== false && value !== "" && value !== 0;
    }
    if (condition.kind === "step") {
      const prefix = stepPrefix(stepId);
      let resolvedId: string;
      if (condition.step.includes("/")) {
        resolvedId = condition.step;
      } else if (prefix) {
        resolvedId = `${prefix}/${condition.step}`;
      } else {
        resolvedId = condition.step;
      }
      const value = ctx.valueStore.get(resolvedId, condition.output);
      return value !== undefined && value !== false && value !== "" && value !== 0;
    }
    return true;
  }
}

async function resolveSecrets(
  plan: RunPlan,
  provider: SecretProvider,
): Promise<Record<string, string>> {
  const secretNames = new Set<string>();
  for (const step of plan.steps) {
    if (step.runtime.secrets) {
      for (const s of step.runtime.secrets) secretNames.add(s);
    }
  }
  const secrets: Record<string, string> = {};
  for (const name of secretNames) {
    const val = await provider.resolve(name);
    if (val !== undefined) secrets[name] = val;
  }
  return secrets;
}

async function resolveRunSecrets(
  request: RunRequest,
  plan: RunPlan,
): Promise<{ secrets: Record<string, string> } | { error: string }> {
  if (!request.secrets) return { secrets: {} };
  try {
    return { secrets: await resolveSecrets(plan, request.secrets) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function buildStepGraph(
  steps: readonly StepDefinition[],
): { graph: StepGraph } | { error: string } {
  try {
    return { graph: buildStepExecutionGraph(steps) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function emptyGraph(): StepGraph {
  return { order: [], stepMap: new Map(), dependents: new Map(), indegree: new Map() };
}

async function ensureWorkspace(workspace: string): Promise<string | undefined> {
  try {
    await mkdir(workspace, { recursive: true });
    return undefined;
  } catch (e) {
    return `failed to create workspace: ${e instanceof Error ? e.message : String(e)}`;
  }
}
