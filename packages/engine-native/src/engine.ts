// Engine — the native engine. Spec 10 — §21, §22.
// Consumes a RunPlan, schedules the Step DAG, executes via runtime drivers,
// emits structured run events, supports cancellation.

import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RunPlan } from "@sverka/ir";
import type { StepDefinition } from "@sverka/core";
import type {
  Engine, RunRequest, RunEvent, RuntimeDriver,
  ValueStore, ArtifactStore, SecretProvider, EngineConfig,
} from "./types.js";
import { createValueStore } from "./value-store.js";
import { createArtifactStore } from "./artifact-store.js";
import { executeStep } from "./step-executor.js";
import { topoSortSteps, transitiveDependents, isStepReady, type StepState } from "./scheduler.js";

/** Create a native engine with the given drivers. */
export function createEngine(config: EngineConfig): Engine {
  return new NativeEngine(config);
}

class NativeEngine implements Engine {
  private readonly config: EngineConfig;
  private cancelled = false;

  constructor(config: EngineConfig) {
    this.config = config;
  }

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    this.cancelled = false;
    const runId = randomUUID();
    const start = Date.now();
    const plan = request.plan;
    const drivers = request.drivers ?? this.config.drivers;
    const maxConcurrent = request.maxConcurrent ?? this.config.maxConcurrent ?? 4;
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(request.artifactDir);

    // Resolve secrets.
    const secrets: Record<string, string> = {};
    if (request.secrets) {
      const secretNames = new Set<string>();
      for (const step of plan.steps) {
        if (step.runtime.secrets) {
          for (const s of step.runtime.secrets) secretNames.add(s);
        }
      }
      for (const name of secretNames) {
        const val = await request.secrets.resolve(name);
        if (val !== undefined) secrets[name] = val;
      }
    }

    // Topological sort.
    let order: readonly string[];
    try {
      order = topoSortSteps(plan.steps);
    } catch {
      yield { type: "run-started", runId, planId: plan.id };
      yield { type: "run-completed", runId, status: "failure", durationMs: Date.now() - start };
      return;
    }

    const stepMap = new Map<string, StepDefinition>();
    for (const s of plan.steps) stepMap.set(s.id, s);

    const states = new Map<string, StepState>();
    for (const s of plan.steps) {
      states.set(s.id, "pending");
    }

    yield { type: "run-started", runId, planId: plan.id };

    // Emit step-pending events.
    for (const s of plan.steps) {
      yield { type: "step-pending", stepId: s.id };
    }

    // Ensure workspace exists.
    await mkdir(request.workspace, { recursive: true });

    const running = new Set<string>();
    const inflight = new Map<Promise<void>, string>();
    let hasFailure = false;
    const eventQueue: RunEvent[] = [];

    const emit = (event: RunEvent): void => {
      eventQueue.push(event);
    };

    const runStep = async (step: StepDefinition): Promise<void> => {
      const driver = drivers.find((d) => d.canExecute(step));
      if (!driver) {
        states.set(step.id, "failed");
        emit({
          type: "step-failed",
          stepId: step.id,
          error: `no runtime driver can execute step '${step.id}'`,
          durationMs: 0,
        });
        hasFailure = true;
        return;
      }

      emit({ type: "step-ready", stepId: step.id });
      states.set(step.id, "running");
      emit({ type: "step-started", stepId: step.id });

      const result = await executeStep({
        step,
        driver,
        workspace: request.workspace,
        artifactStore,
        valueStore,
        secrets,
        emit,
        isCancelled: () => this.cancelled,
      });

      running.delete(step.id);

      if (result.status === "succeeded") {
        states.set(step.id, "succeeded");
        emit({ type: "step-succeeded", stepId: step.id, durationMs: result.durationMs });
      } else if (result.status === "failed") {
        states.set(step.id, "failed");
        emit({ type: "step-failed", stepId: step.id, error: result.error ?? "unknown", durationMs: result.durationMs });
        hasFailure = true;
      } else if (result.status === "cancelled") {
        states.set(step.id, "cancelled");
        emit({ type: "step-cancelled", stepId: step.id });
      }
    };

    // Main scheduling loop.
    let index = 0;

    const launchReady = (): void => {
      while (running.size < maxConcurrent && index < order.length) {
        if (this.cancelled) break;
        const id = order[index]!;
        const step = stepMap.get(id)!;
        const state = states.get(id);

        if (state === "pending") {
          // Check if any producer failed/cancelled → cancel this step.
          const producerFailed = step.dependencies.some((dep) => {
            const ps = states.get(dep.producer);
            return ps === "failed" || ps === "cancelled";
          });
          if (producerFailed) {
            states.set(id, "cancelled");
            emit({ type: "step-cancelled", stepId: id });
            index++;
            continue;
          }

          if (isStepReady(step, states)) {
            running.add(id);
            index++;
            const p = runStep(step);
            inflight.set(p, id);
            p.then(
              () => inflight.delete(p),
              () => inflight.delete(p),
            );
          } else {
            // Not ready yet — will be retried when dependencies complete.
            index++;
          }
        } else {
          // Already processed (cancelled, etc.) — skip.
          index++;
        }
      }
    };

    launchReady();

    while (inflight.size > 0 || (index < order.length && !this.cancelled && !hasFailure)) {
      if (inflight.size > 0) {
        await Promise.race(inflight.keys());
      }
      // Flush events.
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      if (!this.cancelled && !hasFailure) {
        // Reset index to scan for newly-ready steps.
        index = 0;
        launchReady();
      }
    }

    // Cancel remaining pending steps.
    if (this.cancelled || hasFailure) {
      for (const id of order) {
        if (states.get(id) === "pending") {
          states.set(id, "cancelled");
          emit({ type: "step-cancelled", stepId: id });
        }
      }
    }

    // Wait for all inflight.
    await Promise.allSettled(inflight.keys());

    // Flush remaining events.
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    const status = this.cancelled ? "cancelled" : hasFailure ? "failure" : "success";
    yield { type: "run-completed", runId, status, durationMs: Date.now() - start };
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}
