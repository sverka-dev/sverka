// Engine — the native engine. Spec 10 — §21, §22.
// Consumes a RunPlan, schedules the Step DAG, executes via runtime drivers,
// emits structured run events, supports cancellation.

import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RunPlan, InputValue } from "@sverka/ir";
import type { StepDefinition } from "@sverka/core";
import type {
  Engine,
  RunRequest,
  RunEvent,
  ValueStore,
  SecretProvider,
  EngineConfig,
} from "./types.js";
import { createValueStore } from "./value-store.js";
import { createArtifactStore } from "./artifact-store.js";
import { executeStep } from "./step-executor.js";
import { topoSortSteps, transitiveDependents, type StepState } from "./scheduler.js";

/** Create a native engine with the given drivers. */
export function createEngine(config: EngineConfig): Engine {
  return new NativeEngine(config);
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
    const plan = request.plan;
    const drivers = request.drivers ?? this.config.drivers;
    const maxConcurrent = request.maxConcurrent ?? this.config.maxConcurrent ?? 4;

    if (this.activeRun && !this.activeRun.signal.aborted) {
      yield { type: "run-started", runId, planId: plan.id };
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
    const isCancelled = () => abort.signal.aborted;

    try {
      yield { type: "run-started", runId, planId: plan.id };

      let secrets: Record<string, string> = {};
      if (request.secrets) {
        try {
          secrets = await resolveSecrets(plan, request.secrets);
        } catch (e) {
          yield {
            type: "diagnostic",
            stepId: "",
            message: e instanceof Error ? e.message : String(e),
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
      }

      let order: readonly string[];
      try {
        order = topoSortSteps(plan.steps);
      } catch (e) {
        yield {
          type: "diagnostic",
          stepId: "",
          message: e instanceof Error ? e.message : String(e),
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

      const stepMap = new Map<string, StepDefinition>();
      for (const s of plan.steps) stepMap.set(s.id, s);

      // Build dependency graph for scheduling.
      const dependents = new Map<string, string[]>();
      const indegree = new Map<string, number>();
      for (const s of plan.steps) {
        dependents.set(s.id, []);
        indegree.set(s.id, 0);
      }
      for (const s of plan.steps) {
        for (const dep of s.dependencies) {
          dependents.get(dep.producer)?.push(s.id);
          indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
        }
      }

      const states = new Map<string, StepState>();
      for (const id of order) states.set(id, "pending");

      const readyQueue: string[] = [];
      for (const id of order) {
        if ((indegree.get(id) ?? 0) === 0) readyQueue.push(id);
      }

      await mkdir(request.workspace, { recursive: true });

      const valueStore = createValueStore();
      const artifactStore = createArtifactStore(request.artifactDir);

      const eventQueue: RunEvent[] = [];
      class Deferred {
        promise: Promise<void>;
        resolve!: () => void;
        constructor() {
          this.promise = new Promise((r) => {
            this.resolve = r;
          });
        }
      }
      let eventDeferred = new Deferred();
      const emit = (event: RunEvent): void => {
        eventQueue.push(event);
        eventDeferred.resolve();
        eventDeferred = new Deferred();
      };
      const waitForEvent = (): Promise<void> => eventDeferred.promise;

      for (const s of plan.steps) {
        emit({ type: "step-pending", stepId: s.id });
      }
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      const running = new Map<Promise<void>, string>();
      let hasFailure = false;

      const onStepComplete = (id: string): void => {
        for (const depId of dependents.get(id) ?? []) {
          if (states.get(depId) !== "pending") continue;
          const next = (indegree.get(depId) ?? 0) - 1;
          indegree.set(depId, next);
          if (next === 0) readyQueue.push(depId);
        }
      };

      const cancelDependents = (id: string): void => {
        for (const depId of transitiveDependents(plan.steps, id)) {
          if (states.get(depId) === "pending") {
            states.set(depId, "cancelled");
            emit({ type: "step-cancelled", stepId: depId });
          }
        }
      };

      const launch = (): void => {
        while (running.size < maxConcurrent && readyQueue.length > 0 && !isCancelled()) {
          const id = readyQueue.shift()!;
          const step = stepMap.get(id)!;

          if (
            step.condition &&
            !evaluateCondition(step.condition, plan.inputs, valueStore, stepPrefix(step.id))
          ) {
            states.set(id, "skipped");
            emit({ type: "step-skipped", stepId: id });
            onStepComplete(id);
            continue;
          }

          const driver = drivers.find((d) => d.canExecute(step));
          if (!driver) {
            states.set(id, "failed");
            emit({
              type: "step-failed",
              stepId: id,
              error: `no runtime driver can execute step '${id}'`,
              durationMs: 0,
            });
            hasFailure = true;
            cancelDependents(id);
            continue;
          }

          states.set(id, "running");
          emit({ type: "step-ready", stepId: id });
          emit({ type: "step-started", stepId: id });

          const p = (async (): Promise<void> => {
            const result = await executeStep({
              step,
              driver,
              workspace: request.workspace,
              artifactStore,
              valueStore,
              secrets,
              inputs: plan.inputs,
              emit,
              isCancelled,
              signal: abort.signal,
            });

            if (result.status === "succeeded") {
              states.set(step.id, "succeeded");
              emit({
                type: "step-succeeded",
                stepId: step.id,
                durationMs: result.durationMs,
              });
              onStepComplete(step.id);
            } else if (result.status === "failed") {
              states.set(step.id, "failed");
              emit({
                type: "step-failed",
                stepId: step.id,
                error: result.error ?? "unknown",
                durationMs: result.durationMs,
              });
              hasFailure = true;
              cancelDependents(step.id);
            } else if (result.status === "cancelled") {
              states.set(step.id, "cancelled");
              emit({ type: "step-cancelled", stepId: step.id });
              cancelDependents(step.id);
            }
          })();

          running.set(p, id);
          p.then(
            () => running.delete(p),
            () => running.delete(p),
          );
        }
      };

      launch();
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      while (running.size > 0 || readyQueue.length > 0) {
        if (isCancelled()) {
          for (const id of order) {
            if (states.get(id) === "pending") {
              states.set(id, "cancelled");
              emit({ type: "step-cancelled", stepId: id });
            }
          }
          await Promise.allSettled(running.keys());
          break;
        }

        if (readyQueue.length > 0 && running.size < maxConcurrent) {
          launch();
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!;
          }
          continue;
        }

        const waiters: Promise<void>[] = [...running.keys()];
        if (running.size > 0) {
          waiters.push(waitForEvent());
        } else {
          // No running work and readyQueue is empty per loop condition.
          break;
        }

        await Promise.race(waiters);

        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
        launch();
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
      }

      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }

      const status = isCancelled() ? "cancelled" : hasFailure ? "failure" : "success";
      yield { type: "run-completed", runId, status, durationMs: Date.now() - start };
    } finally {
      if (this.activeRun === thisRun) {
        this.activeRun = undefined;
      }
    }
  }

  async cancel(): Promise<void> {
    this.activeRun?.abort();
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

function stepPrefix(stepId: string): string {
  const idx = stepId.lastIndexOf("/");
  return idx === -1 ? "" : stepId.slice(0, idx);
}

function evaluateCondition(
  condition: NonNullable<StepDefinition["condition"]>,
  inputs: Readonly<Record<string, InputValue>> | undefined,
  valueStore: ValueStore,
  prefix: string,
): boolean {
  if (condition.kind === "context") {
    const key = `${condition.namespace}.${condition.field}`;
    const value = inputs?.[key] ?? inputs?.[condition.field];
    return value !== undefined && value !== false && value !== "" && value !== 0;
  }
  if (condition.kind === "step") {
    const stepId = condition.step.includes("/")
      ? condition.step
      : prefix
        ? `${prefix}/${condition.step}`
        : condition.step;
    const value = valueStore.get(stepId, condition.output);
    return value !== undefined && value !== false && value !== "" && value !== 0;
  }
  return true;
}
