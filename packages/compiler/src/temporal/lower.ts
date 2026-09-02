// Native lowering: Definition Graph → TemporalTargetGraph.
// Spec 33 — §19. Temporal code generation target.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  OperationDefinition,
  EntryDefinition,
} from "@sverka/workflow";
import type {
  TemporalTargetGraph,
  TemporalWorkflow,
  TemporalActivity,
  TemporalTargetConfig,
} from "./types.js";
import { TemporalTargetError } from "./errors.js";

/**
 * Lower a Definition Graph to a TemporalTargetGraph.
 * Each entry becomes a Temporal workflow; each reachable step becomes an activity.
 */
export function lowerTemporal(
  graph: DefinitionGraph,
  config?: TemporalTargetConfig,
): TemporalTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new TemporalTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  const rootPipelines = graph.project.pipelines.filter((p) => p.entries.length > 0);
  if (rootPipelines.length === 0) {
    throw new TemporalTargetError("graph has no root pipelines (with entries)", "INVALID_GRAPH");
  }

  if (rootPipelines.length > 1) {
    throw new TemporalTargetError(
      `multi-root pipeline support is not yet implemented: found ${rootPipelines.length} root pipelines (${rootPipelines.map((p) => p.id).join(", ")})`,
      "INVALID_GRAPH",
    );
  }
  const pipeline = rootPipelines[0]!;

  const workflows = lowerWorkflows(pipeline);

  return {
    name: pipeline.id,
    namespace: config?.namespace ?? "default",
    taskQueue: config?.taskQueue ?? "sverka",
    workflows,
  };
}

/**
 * Lower each entry to a Temporal workflow.
 */
function lowerWorkflows(pipeline: PipelineDefinition): readonly TemporalWorkflow[] {
  return pipeline.entries.map((entry) => lowerWorkflow(entry, pipeline));
}

/**
 * Lower a single entry to a Temporal workflow.
 */
function lowerWorkflow(entry: EntryDefinition, pipeline: PipelineDefinition): TemporalWorkflow {
  const reachableSteps = filterReachableSteps(entry.roots, pipeline);
  const sequence = topoSort(reachableSteps);
  const activities = reachableSteps.map(lowerActivity);

  const triggerKind = mapTriggerKind(entry.trigger.kind);
  const cron = entry.trigger.kind === "schedule" ? entry.trigger.cron : undefined;

  return {
    entryId: entry.id,
    triggerKind,
    ...(cron !== undefined ? { cron } : {}),
    activities,
    sequence,
  };
}

/**
 * Map Sverka trigger kind to Temporal trigger kind.
 */
function mapTriggerKind(kind: string): TemporalWorkflow["triggerKind"] {
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
 * Lower a step to a Temporal activity.
 */
function lowerActivity(step: StepDefinition): TemporalActivity {
  const { commands, warnings } = lowerCommands(step.operations);
  return {
    stepId: step.id,
    commands,
    ...(step.runtime.env ? { env: step.runtime.env } : {}),
    ...(step.runtime.workingDir ? { workingDir: step.runtime.workingDir } : {}),
    ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
    ...(step.runtime.secrets ? { secrets: step.runtime.secrets } : {}),
    ...(step.retry !== undefined ? { retry: { max: step.retry.max } } : {}),
    ...(step.timeout !== undefined ? { timeoutMs: step.timeout } : {}),
    ...(step.condition !== undefined ? { condition: step.condition } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Extract shell commands from a step's operations.
 * Non-shell operations are ignored (Temporal has no native scalar/artifact output).
 *
 * Surfaces lowering warnings for unsupported constructs:
 * - background shell execution (not supported by Temporal; command is skipped)
 * - non-shell operations (release, pages, diagnostic, agent, etc.) that are dropped
 * - shell commands containing `secrets.X` references (visible in generated code)
 */
function lowerCommands(
  operations: readonly OperationDefinition[],
): { commands: readonly string[]; warnings: readonly string[] } {
  const commands: string[] = [];
  const warnings: string[] = [];
  for (const op of operations) {
    if (op.kind === "shell") {
      if (op.background) {
        // Background execution is not supported by the Temporal target: the
        // generated activity awaits the process synchronously. Skip the
        // command and emit a warning so it is not silently miscompiled.
        warnings.push(
          `background shell execution is not supported by the Temporal target; command skipped: ${op.command}`,
        );
        continue;
      }
      if (/secrets\.[A-Za-z_][A-Za-z0-9_]*/.test(op.command)) {
        warnings.push(
          `shell command contains a secrets.* reference; secret material will be visible in generated activity code: ${op.command}`,
        );
      }
      commands.push(op.command);
    } else {
      // Release, deployPages, diagnostic, report, agent, exportOutput,
      // exportArtifact, and importArtifact operations have no native Temporal
      // activity representation and are silently dropped — warn explicitly.
      warnings.push(
        `non-shell operation of kind '${op.kind}' is not supported by the Temporal target and is dropped from generated activities`,
      );
    }
  }
  return { commands, warnings };
}

/**
 * Return the steps reachable from the given roots.
 */
function filterReachableSteps(
  roots: readonly string[],
  pipeline: PipelineDefinition,
): readonly StepDefinition[] {
  const byId = new Map(pipeline.steps.map((step) => [step.id, step]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const root of roots) {
    if (!byId.has(root)) {
      throw new TemporalTargetError(
        `entry references unknown root step '${root}'`,
        "INVALID_GRAPH",
      );
    }
    if (!reachable.has(root)) {
      reachable.add(root);
      queue.push(root);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    const step = byId.get(id);
    if (!step) continue;

    for (const producer of producerIds(step)) {
      enqueueProducer(producer, step.id, byId, reachable, queue);
    }
  }

  return pipeline.steps.filter((step) => reachable.has(step.id));
}

/**
 * Validate and enqueue a producer step if not already reachable.
 */
function enqueueProducer(
  producer: string,
  stepId: string,
  byId: Map<string, StepDefinition>,
  reachable: Set<string>,
  queue: string[],
): void {
  if (!byId.has(producer)) {
    throw new TemporalTargetError(
      `step '${stepId}' references unknown producer '${producer}'`,
      "INVALID_GRAPH",
    );
  }
  if (!reachable.has(producer)) {
    reachable.add(producer);
    queue.push(producer);
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
 * Topologically sort steps by dependency order.
 * Producers come before consumers.
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
