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

const INPUT_TYPES = new Set<Input["type"]>(["string", "number", "boolean"]);

/**
 * Bind a Definition Graph's Entry + user inputs into a concrete RunPlan
 * that the native engine can execute.
 */
export function bindRunPlan(options: BindRunPlanOptions): RunPlan {
  const { graph, entryId, inputs } = options;

  if (graph.project.pipelines.length === 0) {
    throw new PlannerError("graph has no pipelines", "INVALID_GRAPH");
  }

  const { pipeline, entry } = findEntry(graph, entryId);
  validateRoots(pipeline, entry);
  validateDependencyProducers(pipeline);

  const reachableSteps = computeReachableSteps(pipeline.steps, entry.roots);
  const boundInputs = bindInputs(pipeline.inputs, inputs);

  const graphId = computeGraphId(graph);

  const boundEntry: BoundEntry = {
    id: entry.id,
    trigger: entry.trigger,
  };

  const planBody = {
    apiVersion: "sverka.dev/v1run" as const,
    graphId,
    entry: boundEntry,
    inputs: boundInputs,
    steps: reachableSteps,
  };

  const id = computeRunPlanId(planBody as Omit<RunPlan, "id" | "createdAt">);

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
 * A step is reachable if it is connected to a root by following
 * `dependencies[].producer` edges backward (i.e. the root's prerequisites).
 * Returns steps in the original graph order, filtered to reachable steps.
 */
export function computeReachableSteps(
  steps: readonly StepDefinition[],
  roots: readonly string[],
): readonly StepDefinition[] {
  const producerMap = buildProducerMap(steps);

  const reachable = new Set<string>();
  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const producer of producerMap.get(id) ?? []) {
      if (!reachable.has(producer)) queue.push(producer);
    }
  }

  return steps.filter((s) => reachable.has(s.id));
}

/**
 * Build a map from each step id to the list of producer step ids it depends on.
 */
function buildProducerMap(steps: readonly StepDefinition[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const step of steps) {
    const producers: string[] = [];
    map.set(step.id, producers);
    for (const dep of step.dependencies) {
      producers.push(dep.producer);
    }
  }
  return map;
}

function findEntry(
  graph: DefinitionGraph,
  entryId: string,
): { pipeline: PipelineDefinition; entry: EntryDefinition } {
  for (const pipeline of graph.project.pipelines) {
    const entry = pipeline.entries.find((e) => e.id === entryId);
    if (entry) return { pipeline, entry };
  }
  throw new PlannerError(
    `entry "${entryId}" not found`,
    "ENTRY_NOT_FOUND",
  );
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

function validateDependencyProducers(pipeline: PipelineDefinition): void {
  const stepIds = new Set(pipeline.steps.map((s) => s.id));
  for (const step of pipeline.steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep.producer)) {
        throw new PlannerError(
          `step "${step.id}" depends on unknown producer "${dep.producer}" in pipeline "${pipeline.id}"`,
          "INVALID_GRAPH",
        );
      }
    }
  }
}

function bindInputs(
  pipelineInputs: Readonly<Record<string, Input>>,
  userInputs: Readonly<Record<string, InputValue>> | undefined,
): Readonly<Record<string, InputValue>> {
  const result: Record<string, InputValue> = {};

  for (const [name, input] of Object.entries(pipelineInputs)) {
    if (input.secret) {
      // Secret values are not embedded in the RunPlan. They are resolved at
      // runtime from a secrets context by name.
      continue;
    }

    const userValue = userInputs?.[name];
    if (userValue !== undefined) {
      assertInputType(userValue, input.type, name);
      result[name] = userValue;
      continue;
    }

    if (input.default !== undefined) {
      assertInputType(input.default, input.type, name);
      result[name] = input.default;
      continue;
    }

    if (input.required ?? true) {
      throw new PlannerError(
        `required input "${name}" has no value and no default`,
        "MISSING_INPUT",
      );
    }
  }

  return result;
}

function assertInputType(
  value: InputValue,
  type: Input["type"] | undefined,
  name: string,
): void {
  if (type === undefined || !INPUT_TYPES.has(type)) {
    throw new PlannerError(
      `input "${name}" has no valid declared type`,
      "INVALID_GRAPH",
    );
  }
  if (typeof value !== type) {
    throw new PlannerError(
      `input "${name}" value ${JSON.stringify(value)} does not match declared type "${type}"`,
      "MISSING_INPUT",
    );
  }
}
