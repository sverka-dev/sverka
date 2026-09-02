// Native lowering: Definition Graph → InngestTargetGraph.
// Spec 35 — §19. Inngest function code generation target.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  OperationDefinition,
  EntryDefinition,
} from "@sverka/workflow";
import type {
  InngestTargetGraph,
  InngestFunction,
  InngestStep,
  InngestTargetConfig,
} from "./types.js";
import { InngestTargetError } from "./errors.js";
import { reachableStepIds, topoSort } from "../internal/graph-utils.js";

/**
 * Lower a Definition Graph to an InngestTargetGraph.
 * Each entry becomes an Inngest function; each reachable step becomes a step.run.
 */
export function lowerInngest(
  graph: DefinitionGraph,
  config?: InngestTargetConfig,
): InngestTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new InngestTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  const rootPipelines = graph.project.pipelines.filter((p) => p.entries.length > 0);
  if (rootPipelines.length === 0) {
    throw new InngestTargetError("graph has no root pipelines (with entries)", "INVALID_GRAPH");
  }

  if (rootPipelines.length > 1) {
    throw new InngestTargetError(
      `multi-root pipeline support is not yet implemented: found ${rootPipelines.length} root pipelines (${rootPipelines.map((p) => p.id).join(", ")})`,
      "INVALID_GRAPH",
    );
  }
  const pipeline = rootPipelines[0]!;

  const functions = lowerFunctions(pipeline);

  return {
    appId: config?.appId ?? pipeline.id,
    functions,
  };
}

/**
 * Lower each entry to an Inngest function.
 */
function lowerFunctions(pipeline: PipelineDefinition): readonly InngestFunction[] {
  return pipeline.entries.map((entry) => lowerFunction(entry, pipeline));
}

/**
 * Lower a single entry to an Inngest function.
 */
function lowerFunction(entry: EntryDefinition, pipeline: PipelineDefinition): InngestFunction {
  const createError = (msg: string, code: string): Error => new InngestTargetError(msg, code);
  const reachableIds = reachableStepIds(entry.roots, pipeline.steps, createError);
  const reachableSteps = pipeline.steps.filter((step) => reachableIds.has(step.id));
  const sequence = topoSort(reachableSteps);
  const steps = reachableSteps.map(lowerStep);

  const triggerKind = mapTriggerKind(entry.trigger.kind);
  const cron = entry.trigger.kind === "schedule" ? entry.trigger.cron : undefined;

  return {
    entryId: entry.id,
    triggerKind,
    ...(cron !== undefined ? { cron } : {}),
    steps,
    sequence,
  };
}

/**
 * Map Sverka trigger kind to Inngest trigger kind.
 */
function mapTriggerKind(kind: string): InngestFunction["triggerKind"] {
  switch (kind) {
    case "manual":
      return "manual";
    case "schedule":
      return "schedule";
    case "push":
      return "push";
    case "changeRequest":
      return "changeRequest";
    default:
      return "manual";
  }
}

/**
 * Lower a step to an Inngest step.
 */
function lowerStep(step: StepDefinition): InngestStep {
  const commands = lowerCommands(step.operations);
  const dependsOn = lowerDependsOn(step);
  const { hasScalarOutput, hasArtifactOutput } = detectOutputs(step);

  return {
    stepId: step.id,
    commands,
    dependsOn,
    ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
    ...(step.retry !== undefined ? { retry: { max: step.retry.max } } : {}),
    ...(step.condition !== undefined ? { condition: step.condition } : {}),
    ...(step.matrix !== undefined
      ? { matrix: { dimensions: step.matrix.dimensions ?? {} } }
      : {}),
    hasScalarOutput,
    hasArtifactOutput,
  };
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
 * Lower step dependencies to producer step IDs.
 */
function lowerDependsOn(step: StepDefinition): readonly string[] {
  const deps: string[] = [];
  for (const dep of step.dependencies) {
    if (!deps.includes(dep.producer)) {
      deps.push(dep.producer);
    }
  }
  for (const op of step.operations) {
    if (op.kind === "importArtifact") {
      if (!deps.includes(op.from)) {
        deps.push(op.from);
      }
    }
  }
  return deps;
}

/**
 * Detect whether a step has scalar or artifact outputs.
 */
function detectOutputs(step: StepDefinition): { hasScalarOutput: boolean; hasArtifactOutput: boolean } {
  let hasScalarOutput = false;
  let hasArtifactOutput = false;
  for (const output of step.outputs) {
    if (output.type === "artifact") {
      hasArtifactOutput = true;
    } else {
      hasScalarOutput = true;
    }
  }
  return { hasScalarOutput, hasArtifactOutput };
}
