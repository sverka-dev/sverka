// Native lowering: Definition Graph → DaggerTargetGraph.
// Spec 34 — §19. Dagger code generation target.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  OperationDefinition,
  EntryDefinition,
} from "@sverka/workflow";
import type {
  DaggerTargetGraph,
  DaggerStep,
  DaggerTargetConfig,
} from "./types.js";
import { DaggerTargetError } from "./errors.js";

/**
 * Lower a Definition Graph to a DaggerTargetGraph.
 * One Dagger function per entry (first entry used for v1).
 */
export function lowerDagger(
  graph: DefinitionGraph,
  config?: DaggerTargetConfig,
): DaggerTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new DaggerTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  const rootPipelines = graph.project.pipelines.filter((p) => p.entries.length > 0);
  if (rootPipelines.length === 0) {
    throw new DaggerTargetError("graph has no root pipelines (with entries)", "INVALID_GRAPH");
  }

  if (rootPipelines.length > 1) {
    throw new DaggerTargetError(
      `multi-root pipeline support is not yet implemented: found ${rootPipelines.length} root pipelines (${rootPipelines.map((p) => p.id).join(", ")})`,
      "INVALID_GRAPH",
    );
  }
  const pipeline = rootPipelines[0]!;
  const entry = pipeline.entries[0]!;

  const reachable = filterReachableSteps(entry.roots, pipeline);
  const steps = lowerSteps(reachable);
  const sequence = topoSort(reachable);

  return {
    moduleName: config?.moduleName ?? pipeline.id,
    entryId: entry.id,
    steps,
    sequence,
  };
}

/**
 * Return the steps reachable from the given roots.
 */
function filterReachableSteps(
  roots: readonly string[],
  pipeline: PipelineDefinition,
): readonly StepDefinition[] {
  const byId = new Map(pipeline.steps.map((s) => [s.id, s]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  enqueueRoots(roots, byId, reachable, queue);

  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    const step = byId.get(id);
    if (!step) continue;

    for (const producer of producerIds(step)) {
      if (!byId.has(producer)) {
        throw new DaggerTargetError(
          `step '${step.id}' references unknown producer '${producer}'`,
          "INVALID_GRAPH",
        );
      }
      if (!reachable.has(producer)) {
        reachable.add(producer);
        queue.push(producer);
      }
    }
  }

  return pipeline.steps.filter((s) => reachable.has(s.id));
}

/**
 * Validate and enqueue root step IDs.
 */
function enqueueRoots(
  roots: readonly string[],
  byId: Map<string, StepDefinition>,
  reachable: Set<string>,
  queue: string[],
): void {
  for (const root of roots) {
    if (!byId.has(root)) {
      throw new DaggerTargetError(
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
 * Return the ids of all producer steps referenced by a step.
 */
function producerIds(step: StepDefinition): readonly string[] {
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
 * Lower reachable steps to Dagger steps.
 */
function lowerSteps(steps: readonly StepDefinition[]): readonly DaggerStep[] {
  return steps.map((step) => {
    const name = shortName(step.id);
    const commands = lowerCommands(step.operations);
    const dependsOn = lowerDependsOn(step);
    return {
      stepId: step.id,
      name,
      commands,
      dependsOn,
      runtime: step.runtime,
      ...(step.condition !== undefined ? { condition: step.condition } : {}),
      ...(step.matrix !== undefined ? { matrix: step.matrix } : {}),
      ...(step.retry !== undefined ? { retry: { max: step.retry.max } } : {}),
      ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
    };
  });
}

/**
 * Extract shell commands from a step's operations.
 */
function lowerCommands(operations: readonly OperationDefinition[]): readonly string[] {
  const commands: string[] = [];
  for (const op of operations) {
    if (op.kind === "shell") {
      commands.push(op.command);
    }
  }
  return commands;
}

/**
 * Lower step dependencies to short names.
 */
function lowerDependsOn(step: StepDefinition): readonly string[] {
  const deps: string[] = [];
  for (const dep of step.dependencies) {
    const short = shortName(dep.producer);
    if (!deps.includes(short)) deps.push(short);
  }
  for (const op of step.operations) {
    if (op.kind === "importArtifact") {
      const short = shortName(op.from);
      if (!deps.includes(short)) deps.push(short);
    }
  }
  return deps;
}

/**
 * Shorten a step ID to its last path segment.
 */
function shortName(stepId: string): string {
  return stepId.includes("/") ? stepId.split("/").pop()! : stepId;
}

/**
 * Topologically sort steps by dependency order.
 */
function topoSort(steps: readonly StepDefinition[]): readonly string[] {
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
