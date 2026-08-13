// Run Plan binding — binds a Definition Graph's Entry + inputs into a RunPlan.
// Spec 13 — §22.1 component 1. Architecture spec §10, §22.

import type {
  DefinitionGraph,
  StepDefinition,
  PipelineDefinition,
  EntryDefinition,
  Input,
} from "@sverka/core";
import type { RunPlan, InputValue, BoundEntry } from "@sverka/ir";
import { computeGraphId, computeRunPlanId } from "@sverka/ir";
import { PlannerError } from "./errors.js";

export interface BindRunPlanOptions {
  readonly graph: DefinitionGraph;
  readonly entryId: string;
  readonly inputs?: Readonly<Record<string, InputValue>>;
}

/**
 * Bind a Definition Graph's Entry + user inputs into a concrete RunPlan
 * that the native engine can execute.
 */
export function bindRunPlan(options: BindRunPlanOptions): RunPlan {
  const { graph, entryId, inputs } = options;

  // Validate graph has pipelines.
  if (graph.project.pipelines.length === 0) {
    throw new PlannerError("graph has no pipelines", "INVALID_GRAPH");
  }

  // For v0, we operate on the first (and typically only) pipeline.
  const pipeline = graph.project.pipelines[0]!;

  // Find the entry.
  const entry = findEntry(pipeline, entryId);

  // Validate roots exist.
  validateRoots(pipeline, entry);

  // Compute reachable steps from entry roots.
  const reachableSteps = computeReachableSteps(pipeline.steps, entry.roots);

  // Bind inputs.
  const boundInputs = bindInputs(pipeline.inputs, inputs);

  // Compute graph ID.
  const graphId = computeGraphId(graph);

  // Build the bound entry.
  const boundEntry: BoundEntry = {
    id: entry.id,
    trigger: entry.trigger,
  };

  // Compute run plan ID (excluding id and createdAt).
  const planBody = {
    apiVersion: "sverka.dev/v1run" as const,
    graphId,
    entry: boundEntry,
    inputs: boundInputs,
    steps: reachableSteps,
  };
  const id = computeRunPlanId(planBody);

  // Set createdAt.
  const createdAt = new Date().toISOString();

  return {
    apiVersion: "sverka.dev/v1run",
    id,
    graphId,
    entry: boundEntry,
    inputs: boundInputs,
    steps: reachableSteps,
    createdAt,
  };
}

/**
 * Compute the transitive closure of reachable steps from the given roots.
 * A step is reachable if it is connected to any root via dependency edges
 * (in either direction — producers or dependents). This ensures the Run
 * Plan includes all steps needed to execute the entry.
 *
 * Returns steps in the original graph order, filtered to reachable steps
 * (no duplicates).
 */
export function computeReachableSteps(
  steps: readonly StepDefinition[],
  roots: readonly string[],
): readonly StepDefinition[] {
  const stepMap = new Map<string, StepDefinition>();
  for (const s of steps) stepMap.set(s.id, s);

  // Build adjacency in both directions.
  const dependents = new Map<string, string[]>(); // producer → [dependents]
  const producers = new Map<string, string[]>();  // step → [producers]
  for (const s of steps) {
    for (const dep of s.dependencies) {
      dependents.set(dep.producer, [...(dependents.get(dep.producer) ?? []), s.id]);
      producers.set(s.id, [...(producers.get(s.id) ?? []), dep.producer]);
    }
  }

  const reachable = new Set<string>();
  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    // Add dependents (forward).
    for (const dep of dependents.get(id) ?? []) {
      if (!reachable.has(dep)) queue.push(dep);
    }
    // Add producers (backward).
    for (const prod of producers.get(id) ?? []) {
      if (!reachable.has(prod)) queue.push(prod);
    }
  }

  // Return in original graph order, filtered to reachable.
  return steps.filter((s) => reachable.has(s.id));
}

function findEntry(pipeline: PipelineDefinition, entryId: string): EntryDefinition {
  const entry = pipeline.entries.find((e) => e.id === entryId);
  if (!entry) {
    throw new PlannerError(
      `entry "${entryId}" not found in pipeline "${pipeline.id}"`,
      "ENTRY_NOT_FOUND",
    );
  }
  return entry;
}

function validateRoots(pipeline: PipelineDefinition, entry: EntryDefinition): void {
  const stepIds = new Set(pipeline.steps.map((s) => s.id));
  for (const root of entry.roots) {
    if (!stepIds.has(root)) {
      throw new PlannerError(
        `entry root "${root}" not found in pipeline steps`,
        "ROOT_NOT_FOUND",
      );
    }
  }
}

function bindInputs(
  pipelineInputs: Readonly<Record<string, Input>>,
  userInputs: Readonly<Record<string, InputValue>> | undefined,
): Readonly<Record<string, InputValue>> {
  const result: Record<string, InputValue> = {};

  for (const [name, input] of Object.entries(pipelineInputs)) {
    // Check user override first.
    const userValue = userInputs?.[name];
    if (userValue !== undefined) {
      result[name] = userValue;
      continue;
    }

    // Fall back to default.
    if (input.default !== undefined) {
      result[name] = input.default;
      continue;
    }

    // No default and no override — check if required.
    if (input.required ?? true) {
      throw new PlannerError(
        `required input "${name}" has no value and no default`,
        "MISSING_INPUT",
      );
    }
    // Optional input with no value — skip.
  }

  return result;
}
