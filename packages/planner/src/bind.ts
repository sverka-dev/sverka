// Run Plan binding — binds a Definition Graph's Entry + inputs into a RunPlan.
// Spec 13 — §22.1 component 1. Architecture spec §10, §22.

import type {
  DefinitionGraph,
  StepDefinition,
  PipelineDefinition,
  EntryDefinition,
  Input,
} from "@sverka/core";
import { validateGraph, expandPipelineCalls } from "@sverka/core";
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

  validateGraphShape(graph);

  if (graph.project.pipelines.length === 0) {
    throw new PlannerError("graph has no pipelines", "INVALID_GRAPH");
  }

  const { pipeline, entry } = findEntry(graph, entryId);
  validateRoots(pipeline, entry);
  validatePipeline(graph, pipeline);

  const reachableSteps = computeReachableSteps(pipeline.steps, entry.roots);
  // Expand pipeline-call steps into inline callee steps for the native engine.
  const expandedSteps = expandPipelineCalls(graph, reachableSteps);
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
    steps: expandedSteps,
  };

  const id = computeRunPlanId(planBody as Omit<RunPlan, "id" | "createdAt">);

  const createdAt = new Date().toISOString();

  return {
    apiVersion: "sverka.dev/v1run",
    id,
    graphId,
    entry: boundEntry,
    inputs: boundInputs,
    steps: expandedSteps,
    createdAt,
  };
}

/**
 * Validate that the runtime value has the shape of a DefinitionGraph before
 * any field is dereferenced. Malformed values become PlannerError(INVALID_GRAPH)
 * instead of TypeError.
 */
function validateGraphShape(value: DefinitionGraph): void {
  const graph = value as unknown as Record<string, unknown>;

  if (typeof graph !== "object" || graph === null) {
    throw new PlannerError("graph must be an object", "INVALID_GRAPH");
  }

  const project = graph.project;
  if (typeof project !== "object" || project === null) {
    throw new PlannerError("graph.project must be an object", "INVALID_GRAPH");
  }

  const pipelines = (project as Record<string, unknown>).pipelines;
  if (!Array.isArray(pipelines)) {
    throw new PlannerError("graph.project.pipelines must be an array", "INVALID_GRAPH");
  }

  for (let i = 0; i < pipelines.length; i++) {
    const pipeline = pipelines[i] as Record<string, unknown>;
    validatePipelineShape(pipeline, i);
  }
}

function validatePipelineShape(
  value: unknown,
  index: number,
): void {
  const pipeline = value as Record<string, unknown>;
  if (typeof pipeline !== "object" || pipeline === null) {
    throw new PlannerError(`graph.project.pipelines[${index}] must be an object`, "INVALID_GRAPH");
  }
  validatePipelineFields(pipeline, index);
  validatePipelineChildren(pipeline, index);
}

function validatePipelineFields(pipeline: Record<string, unknown>, index: number): void {
  if (typeof pipeline.id !== "string") {
    throw new PlannerError(
      `graph.project.pipelines[${index}].id must be a string`,
      "INVALID_GRAPH",
    );
  }
  if (!Array.isArray(pipeline.entries)) {
    throw new PlannerError(
      `graph.project.pipelines[${index}].entries must be an array`,
      "INVALID_GRAPH",
    );
  }
  if (!Array.isArray(pipeline.steps)) {
    throw new PlannerError(
      `graph.project.pipelines[${index}].steps must be an array`,
      "INVALID_GRAPH",
    );
  }
  if (typeof pipeline.inputs !== "object" || pipeline.inputs === null || Array.isArray(pipeline.inputs)) {
    throw new PlannerError(
      `graph.project.pipelines[${index}].inputs must be an object`,
      "INVALID_GRAPH",
    );
  }
}

function validatePipelineChildren(pipeline: Record<string, unknown>, index: number): void {
  const inputs = pipeline.inputs as Record<string, unknown>;
  for (const [name, descriptor] of Object.entries(inputs)) {
    validateInputDescriptor(descriptor, index, name);
  }
  const entries = pipeline.entries;
  if (!Array.isArray(entries)) return;
  const steps = pipeline.steps;
  if (!Array.isArray(steps)) return;
  for (let j = 0; j < entries.length; j++) {
    validateEntryShape(entries[j], index, j);
  }
  for (let j = 0; j < steps.length; j++) {
    validateStepShape(steps[j], index, j);
  }
}

function validateInputDescriptor(
  value: unknown,
  pipelineIndex: number,
  name: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].inputs.${name} must be an object`,
      "INVALID_GRAPH",
    );
  }

  const descriptor = value as Record<string, unknown>;
  const type = descriptor.type;
  if (type !== undefined && !INPUT_TYPES.has(type as Input["type"])) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].inputs.${name} has invalid type`,
      "INVALID_GRAPH",
    );
  }
}

function validateEntryShape(
  value: unknown,
  pipelineIndex: number,
  index: number,
): void {
  const entry = value as Record<string, unknown>;
  if (typeof entry !== "object" || entry === null) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].entries[${index}] must be an object`,
      "INVALID_GRAPH",
    );
  }
  if (typeof entry.id !== "string") {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].entries[${index}].id must be a string`,
      "INVALID_GRAPH",
    );
  }
  if (!Array.isArray(entry.roots)) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].entries[${index}].roots must be an array`,
      "INVALID_GRAPH",
    );
  }
}

function validateStepShape(
  value: unknown,
  pipelineIndex: number,
  index: number,
): void {
  const step = value as Record<string, unknown>;
  if (typeof step !== "object" || step === null) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].steps[${index}] must be an object`,
      "INVALID_GRAPH",
    );
  }
  if (typeof step.id !== "string") {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].steps[${index}].id must be a string`,
      "INVALID_GRAPH",
    );
  }
  if (!Array.isArray(step.dependencies)) {
    throw new PlannerError(
      `graph.project.pipelines[${pipelineIndex}].steps[${index}].dependencies must be an array`,
      "INVALID_GRAPH",
    );
  }
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
  const queue: string[] = [];

  for (const id of roots) {
    if (!reachable.has(id)) {
      reachable.add(id);
      queue.push(id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    for (const producer of producerMap.get(id) ?? []) {
      if (!reachable.has(producer)) {
        reachable.add(producer);
        queue.push(producer);
      }
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

function validatePipeline(graph: DefinitionGraph, pipeline: PipelineDefinition): void {
  try {
    validateGraph({
      project: {
        id: graph.project.id,
        pipelines: [pipeline],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PlannerError(message, "INVALID_GRAPH", err);
  }
}

function bindInputs(
  pipelineInputs: Readonly<Record<string, Input>>,
  userInputs: Readonly<Record<string, InputValue>> | undefined,
): Readonly<Record<string, InputValue>> {
  const result: Record<string, InputValue> = {};

  for (const [name, input] of Object.entries(pipelineInputs)) {
    const type = input.type as Input["type"] | undefined;
    validateInputType(name, type);

    if (input.secret) {
      // Secret values are not embedded in the RunPlan. They are resolved at
      // runtime from a secrets context by name.
      continue;
    }

    const userValue = userInputs?.[name];
    if (userValue !== undefined) {
      assertInputValue(userValue, type, name);
      result[name] = userValue;
      continue;
    }

    if (input.default !== undefined) {
      assertInputValue(input.default, type, name);
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

function validateInputType(
  name: string,
  type: Input["type"] | undefined,
): asserts type is Input["type"] {
  if (type === undefined || !INPUT_TYPES.has(type)) {
    throw new PlannerError(
      `input "${name}" has no valid declared type`,
      "INVALID_GRAPH",
    );
  }
}

function assertInputValue(
  value: InputValue,
  type: Input["type"],
  name: string,
): void {
  if (type === "array") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new PlannerError(
        `input "${name}" value ${JSON.stringify(value)} does not match declared type "array" (expected string array)`,
        "INVALID_INPUT",
      );
    }
    return;
  }
  const expected = type === "choice" ? "string" : type;
  const actual = typeof value;
  if (actual !== expected) {
    throw new PlannerError(
      `input "${name}" value ${JSON.stringify(value)} does not match declared type "${type}"`,
      "INVALID_INPUT",
    );
  }
}
