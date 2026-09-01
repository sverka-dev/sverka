// Native lowering: Definition Graph → DroneTargetGraph.
// Spec 36 — §19. Drone CI YAML target.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  OperationDefinition,
  EntryDefinition,
} from "@sverka/workflow";
import type { DroneTargetGraph, DroneStep, DroneTrigger, DroneTargetConfig } from "./types.js";
import { DroneTargetError } from "./errors.js";

const DEFAULT_IMAGE = "node:24";

/**
 * Lower a Definition Graph to a DroneTargetGraph.
 * One Drone step per reachable Step. Triggers derived from pipeline entries.
 */
export function lowerDrone(
  graph: DefinitionGraph,
  config?: DroneTargetConfig,
): DroneTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new DroneTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  const rootPipelines = graph.project.pipelines.filter((p) => p.entries.length > 0);
  if (rootPipelines.length === 0) {
    throw new DroneTargetError("graph has no root pipelines (with entries)", "INVALID_GRAPH");
  }

  // Multi-root pipeline support is not yet implemented — reject explicitly.
  if (rootPipelines.length > 1) {
    throw new DroneTargetError(
      `multi-root pipeline support is not yet implemented: found ${rootPipelines.length} root pipelines (${rootPipelines.map((p) => p.id).join(", ")})`,
      "INVALID_GRAPH",
    );
  }
  const pipeline = rootPipelines[0]!;

  const reachableSteps = filterReachableSteps(pipeline);
  const defaultImage = config?.image ?? DEFAULT_IMAGE;
  const steps = lowerSteps(reachableSteps, defaultImage);
  const trigger = lowerTrigger(pipeline.entries);

  return {
    name: pipeline.id,
    type: config?.type ?? "docker",
    steps,
    trigger,
  };
}

/**
 * Return the steps reachable from any entry root by following dependencies.
 */
function filterReachableSteps(pipeline: PipelineDefinition): readonly StepDefinition[] {
  if (pipeline.steps.length === 0) {
    for (const entry of pipeline.entries) {
      if (entry.roots.length > 0) {
        throw new DroneTargetError(
          `entry '${entry.id}' references root steps but pipeline has no steps`,
          "INVALID_GRAPH",
        );
      }
    }
    return [];
  }

  const allRoots = pipeline.entries.flatMap((entry) => [...entry.roots]);
  const reachable = reachableStepIds(allRoots, pipeline);
  return pipeline.steps.filter((step) => reachable.has(step.id));
}

/**
 * Compute the set of step IDs reachable from the given roots.
 */
function reachableStepIds(
  roots: readonly string[],
  pipeline: PipelineDefinition,
): Set<string> {
  const byId = new Map(pipeline.steps.map((step) => [step.id, step]));
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
        throw new DroneTargetError(
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

  return reachable;
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
      throw new DroneTargetError(
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
 * Lower reachable steps to Drone steps.
 * Step ID is shortened to the last path segment (matches GitLab/GitHub pattern).
 */
function lowerSteps(
  steps: readonly StepDefinition[],
  defaultImage: string,
): readonly DroneStep[] {
  // Build the name map first so dependencies can reference the correct short name.
  const used = new Set<string>();
  const nameByStepId = new Map<string, string>();
  for (const step of steps) {
    nameByStepId.set(step.id, uniqueName(step.id, used));
  }

  return steps.map((step) => {
    const name = nameByStepId.get(step.id)!;
    const commands = lowerCommands(step.operations);
    const image = resolveImage(step, defaultImage);
    const dependsOn = lowerDependsOn(step, nameByStepId);
    return {
      name,
      image,
      commands,
      dependsOn,
    };
  });
}

/**
 * Shorten a step ID to its last path segment, ensuring uniqueness.
 */
function uniqueName(stepId: string, used: Set<string>): string {
  const shortId = stepId.includes("/") ? stepId.split("/").pop()! : stepId;
  let name = shortId;
  let suffix = 1;
  while (used.has(name)) {
    name = `${shortId}-${suffix}`;
    suffix++;
  }
  used.add(name);
  return name;
}

/**
 * Extract shell commands from a step's operations.
 * Non-shell operations are ignored (Drone has no native scalar/artifact output).
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
 * Resolve the container image for a step.
 * Container runtime → step.runtime.image. Host runtime → default image.
 */
function resolveImage(step: StepDefinition, defaultImage: string): string {
  if (step.runtime.mode === "container" && step.runtime.image) {
    return step.runtime.image;
  }
  return defaultImage;
}

/**
 * Lower step dependencies to Drone depends_on using the generated name map.
 */
function lowerDependsOn(step: StepDefinition, nameByStepId: Map<string, string>): readonly string[] {
  const deps: string[] = [];
  for (const dep of step.dependencies) {
    const name = nameByStepId.get(dep.producer) ?? dep.producer;
    if (!deps.includes(name)) {
      deps.push(name);
    }
  }
  for (const op of step.operations) {
    if (op.kind === "importArtifact") {
      const name = nameByStepId.get(op.from) ?? op.from;
      if (!deps.includes(name)) {
        deps.push(name);
      }
    }
  }
  return deps;
}

/**
 * Lower pipeline entries to a Drone trigger block.
 * Combines all entry triggers into one trigger (Drone has one trigger per pipeline).
 */
function lowerTrigger(entries: readonly EntryDefinition[]): DroneTrigger {
  const branches: string[] = [];
  const events: string[] = [];
  const crons: string[] = [];

  for (const entry of entries) {
    switch (entry.trigger.kind) {
      case "push":
        events.push("push");
        if (entry.trigger.filter?.branches) {
          branches.push(...entry.trigger.filter.branches);
        }
        break;
      case "changeRequest":
        events.push("pull_request");
        break;
      case "manual":
        events.push("custom");
        break;
      case "schedule":
        events.push("cron");
        crons.push(entry.trigger.cron);
        break;
    }
  }

  const trigger: DroneTrigger = {
    ...(branches.length > 0 ? { branch: dedupe(branches) } : {}),
    ...(events.length > 0 ? { event: dedupe(events) } : {}),
    ...(crons.length > 0 ? { cron: dedupe(crons) } : {}),
  };
  return trigger;
}

/**
 * Deduplicate an array while preserving order.
 */
function dedupe<T>(arr: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
