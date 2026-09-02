// Shared graph utilities for compiler target lowering.
// Extracts common BFS reachability and topological sort logic that was
// duplicated across drone, temporal, dagger, and inngest lower.ts files.

import type { StepDefinition } from "@sverka/workflow";

/**
 * Return the ids of all producer steps referenced by a step.
 * Producers come from step.dependencies and importArtifact operations.
 */
export function producerIds(step: StepDefinition): readonly string[] {
  const ids: string[] = [];
  for (const dep of step.dependencies) {
    ids.push(dep.producer);
  }
  for (const op of step.operations) {
    if (op.kind === "importArtifact") {
      ids.push(op.from);
    }
  }
  return ids;
}

/**
 * Validate and enqueue root step IDs for BFS traversal.
 * Throws if a root step ID is not found in the step map.
 */
export function enqueueRoots(
  roots: readonly string[],
  byId: Map<string, StepDefinition>,
  reachable: Set<string>,
  queue: string[],
  createError: (message: string, code: string) => Error,
): void {
  for (const root of roots) {
    if (!byId.has(root)) {
      throw createError(
        `entry references unknown root step '${root}'`,
        "INVALID_GRAPH",
      );
    }
    if (!reachable.has(root)) {
      reachable.add(root);
      queue.push(root);
    }
  }
}

/**
 * BFS traversal from root step IDs, collecting all reachable step IDs.
 * Throws if a referenced producer is not found in the step map.
 */
export function reachableStepIds(
  roots: readonly string[],
  steps: readonly StepDefinition[],
  createError: (message: string, code: string) => Error,
): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  enqueueRoots(roots, byId, reachable, queue, createError);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    const step = byId.get(id);
    if (!step) continue;

    for (const producer of producerIds(step)) {
      if (!byId.has(producer)) {
        throw createError(
          `step '${id}' references unknown producer '${producer}'`,
          "INVALID_GRAPH",
        );
      }
      if (!reachable.has(producer)) {
        reachable.add(producer);
        queue.push(producer);
      }
    }
  }

  return reachable;
}

/**
 * Topologically sort steps by dependency order (producers before consumers).
 * Only includes steps in the given list. Does NOT detect cycles.
 */
export function topoSort(steps: readonly StepDefinition[]): readonly string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const step = byId.get(id);
    if (!step) return;
    for (const producer of producerIds(step)) {
      if (byId.has(producer)) {
        visit(producer);
      }
    }
    result.push(id);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return result;
}

/**
 * Topologically sort steps with cycle detection.
 * Throws if a cycle is found.
 */
export function topoSortWithCycleDetection(
  steps: readonly StepDefinition[],
  createError: (message: string, code: string) => Error,
): readonly string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const result: string[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (inProgress.has(id)) {
      throw createError(
        `cycle detected in step dependencies at '${id}'`,
        "INVALID_GRAPH",
      );
    }
    inProgress.add(id);
    const step = byId.get(id);
    if (!step) return;
    for (const producer of producerIds(step)) {
      if (byId.has(producer)) {
        visit(producer);
      }
    }
    inProgress.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return result;
}
