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
import { reachableStepIds, topoSortWithCycleDetection } from "../internal/graph-utils.js";

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
  const createError = (msg: string, code: string) => new TemporalTargetError(msg, code);
  const reachable = reachableStepIds(entry.roots, pipeline.steps, createError);
  const reachableSteps = pipeline.steps.filter((step) => reachable.has(step.id));
  const sequence = topoSortWithCycleDetection(reachableSteps, createError);
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
  const { commands, backgroundCommands, warnings } = lowerCommands(step.operations);
  return {
    stepId: step.id,
    commands,
    ...(backgroundCommands.length > 0 ? { backgroundCommands } : {}),
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

const SECRET_REF_RE = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Extract shell commands from a step's operations.
 * Non-shell operations are ignored (Temporal has no native scalar/artifact output).
 *
 * Surfaces lowering warnings for unsupported constructs:
 * - background shell execution (emulated as detached spawn in generated code)
 * - non-shell operations (release, pages, diagnostic, agent, etc.) that are dropped
 * - shell commands containing `secrets.X` references (secret names listed, not values)
 */
function lowerCommands(
  operations: readonly OperationDefinition[],
): {
  commands: readonly string[];
  backgroundCommands: readonly string[];
  warnings: readonly string[];
} {
  const commands: string[] = [];
  const backgroundCommands: string[] = [];
  const warnings: string[] = [];
  for (const op of operations) {
    if (op.kind === "shell") {
      if (op.background) {
        // Background execution is emulated: the command is emitted as a
        // detached spawn in the generated activity (not awaited). This
        // preserves the command rather than silently dropping it.
        backgroundCommands.push(op.command);
        warnings.push(
          `background shell execution is emulated as a detached spawn in the Temporal target; the activity does not await it`,
        );
        continue;
      }
      const secretNames = extractSecretNames(op.command);
      if (secretNames.length > 0) {
        warnings.push(
          `shell command references secrets (${secretNames.join(", ")}); secret values are injected from the runtime secret store at execution time and are not embedded in generated code`,
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
  return { commands, backgroundCommands, warnings };
}

/**
 * Extract secret names referenced via `secrets.NAME` in a command string.
 * Returns only the names, never the surrounding command text.
 */
function extractSecretNames(command: string): string[] {
  const names = new Set<string>();
  SECRET_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECRET_REF_RE.exec(command)) !== null) {
    names.add(m[1]!);
  }
  return [...names];
}

