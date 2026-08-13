// Scheduler — topological sort + concurrent execution of Step DAG.
// Spec 10 — §22.1 component 2, §22.3. Reuses Kahn's algorithm concept
// from the old runtime/internal/topo.ts but operates on StepDefinition.

import type { StepDefinition } from "@sverka/core";
import { SchedulerError } from "./errors.js";

export type StepState = "pending" | "ready" | "running" | "succeeded" | "failed" | "cancelled";

export interface SchedulerEntry {
  readonly step: StepDefinition;
  state: StepState;
  error?: string;
  durationMs?: number;
}

/**
 * Topologically sort steps by their dependency edges.
 * Returns the sorted order, or throws SchedulerError on cycle.
 */
export function topoSortSteps(steps: readonly StepDefinition[]): readonly string[] {
  const ids = new Set(steps.map((s) => s.id));
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const s of steps) {
    dependents.set(s.id, []);
    indegree.set(s.id, 0);
  }

  for (const s of steps) {
    for (const dep of s.dependencies) {
      if (!ids.has(dep.producer)) continue;
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
    for (const dep of s.dependencies) {
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
 */
export function isStepReady(
  step: StepDefinition,
  states: Map<string, StepState>,
): boolean {
  const state = states.get(step.id);
  if (state !== "pending") return false;
  return step.dependencies.every((dep) => {
    const producerState = states.get(dep.producer);
    return producerState === "succeeded";
  });
}
