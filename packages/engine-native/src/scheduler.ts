// Scheduler — topological sort + concurrent execution of Step DAG.
// Spec 10 — §22.1 component 2, §22.3.

import type { StepDefinition, Dependency } from "@sverka/core";
import { SchedulerError } from "./errors.js";

export type StepState = "pending" | "ready" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";

export interface SchedulerEntry {
  readonly step: StepDefinition;
  state: StepState;
  error?: string;
  durationMs?: number;
}

/**
 * Topologically sort steps by their dependency edges.
 * Returns the sorted order, or throws SchedulerError on cycle or unknown producer.
 */
export function topoSortSteps(steps: readonly StepDefinition[]): readonly string[] {
  const ids = new Set<string>(steps.map((s) => s.id));
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const s of steps) {
    dependents.set(s.id, []);
    indegree.set(s.id, 0);
  }

  for (const s of steps) {
    for (const dep of s.dependencies) {
      if (!ids.has(dep.producer)) {
        throw new SchedulerError(
          `step '${s.id}' depends on unknown producer '${dep.producer}'`,
        );
      }
      dependents.get(dep.producer)?.push(s.id);
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm, preserving input order among ready siblings.
  const ready: string[] = [];
  for (const s of steps) {
    if ((indegree.get(s.id) ?? 0) === 0) ready.push(s.id);
  }

  const order: string[] = [];
  let head = 0;
  while (head < ready.length) {
    const id = ready[head]!;
    head++;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) ready.push(dep);
    }
  }

  if (order.length < steps.length) {
    const remaining = steps.filter((s) => (indegree.get(s.id) ?? 0) > 0);
    throw new SchedulerError(
      `dependency cycle detected among: ${remaining.map((s) => s.id).join(", ")}`,
    );
  }

  return order;
}

/**
 * Compute the transitive set of dependents of a step (steps that depend on
 * it, directly or transitively). Used for cancellation on failure.
 */
export function transitiveDependents(steps: readonly StepDefinition[], id: string): Set<string> {
  const depMap = new Map<string, string[]>();
  for (const s of steps) {
    for (const dep of s.dependencies as readonly Dependency[]) {
      depMap.set(dep.producer, [...(depMap.get(dep.producer) ?? []), s.id]);
    }
  }

  const result = new Set<string>();
  const queue: string[] = [...(depMap.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (result.has(cur)) continue;
    result.add(cur);
    for (const d of depMap.get(cur) ?? []) {
      if (!result.has(d)) queue.push(d);
    }
  }
  return result;
}

/**
 * Check if a step is ready to run — all producers have succeeded.
 * Throws if a producer id is unknown.
 */
export function isStepReady(
  step: StepDefinition,
  states: Map<string, StepState>,
): boolean {
  const state = states.get(step.id);
  if (state !== "pending") return false;
  const ids = new Set<string>();
  for (const s of states.keys()) ids.add(s);
  return step.dependencies.every((dep: Dependency) => {
    if (!ids.has(dep.producer)) {
      throw new SchedulerError(
        `step '${step.id}' depends on unknown producer '${dep.producer}'`,
      );
    }
    const producerState = states.get(dep.producer);
    return producerState === "succeeded";
  });
}
