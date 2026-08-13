// Native lowering: Definition Graph → GithubTargetGraph.
// Spec 08 — §18.1, §19.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  EntryDefinition,
  OperationDefinition,
  Dependency,
} from "@sverka/core";
import type { Trigger } from "@sverka/constructs";
import type {
  GithubTargetGraph,
  GithubTriggers,
  GithubJob,
  GithubStep,
} from "./types.js";
import { GithubTargetError } from "./errors.js";

/**
 * Lower a Definition Graph to a GithubTargetGraph.
 * One GitHub job per reachable Step. Triggers collected from all entries.
 */
export function lowerGithub(graph: DefinitionGraph): GithubTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new GithubTargetError("graph has no pipelines", "INVALID_GRAPH");
  }
  if (graph.project.pipelines.length > 1) {
    throw new GithubTargetError(
      "multi-pipeline graphs are not supported in v0",
      "INVALID_GRAPH",
    );
  }

  const pipeline = graph.project.pipelines[0]!;
  const reachableSteps = filterReachableSteps(pipeline);
  const jobIdMap = buildJobIdMap(reachableSteps);

  const triggers = lowerTriggers(pipeline.entries);
  const jobs = lowerSteps(reachableSteps, jobIdMap);

  return {
    name: pipeline.id,
    on: triggers,
    jobs,
    env: collectEnv(pipeline),
  };
}

/**
 * Return the steps reachable from any entry root by following dependencies.
 */
function filterReachableSteps(
  pipeline: PipelineDefinition,
): readonly StepDefinition[] {
  if (pipeline.steps.length === 0) {
    const invalidRoot = pipeline.entries
      .flatMap((e) => e.roots)
      .find((root) => root.length > 0);
    if (invalidRoot) {
      throw new GithubTargetError(
        `entry references unknown root step '${invalidRoot}'`,
        "INVALID_GRAPH",
      );
    }
    return [];
  }

  const byId = new Map(pipeline.steps.map((step) => [step.id, step]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const entry of pipeline.entries) {
    enqueueRoots(entry.roots, byId, reachable, queue);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = byId.get(id);
    if (!step) continue;
    enqueueDependencies(step, byId, reachable, queue);
  }

  return pipeline.steps.filter((step) => reachable.has(step.id));
}

function enqueueRoots(
  roots: readonly string[],
  byId: Map<string, StepDefinition>,
  reachable: Set<string>,
  queue: string[],
): void {
  for (const root of roots) {
    if (!byId.has(root)) {
      throw new GithubTargetError(
        `entry references unknown root step '${root}'`,
        "INVALID_GRAPH",
      );
    }
    enqueueIfNew(root, reachable, queue);
  }
}

function enqueueDependencies(
  step: StepDefinition,
  byId: Map<string, StepDefinition>,
  reachable: Set<string>,
  queue: string[],
): void {
  for (const dep of step.dependencies) {
    const producer = dep.producer;
    if (!byId.has(producer)) {
      throw new GithubTargetError(
        `step depends on unknown producer '${producer}'`,
        "INVALID_GRAPH",
      );
    }
    enqueueIfNew(producer, reachable, queue);
  }
}

function enqueueIfNew(
  id: string,
  reachable: Set<string>,
  queue: string[],
): void {
  if (!reachable.has(id)) {
    reachable.add(id);
    queue.push(id);
  }
}

/**
 * Build a mapping from full step IDs (e.g., "ci/lint") to GitHub-safe
 * job IDs (e.g., "lint"). If there are collisions, append a suffix.
 */
function buildJobIdMap(steps: readonly StepDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();

  for (const step of steps) {
    // Use the last segment of the path as the job ID.
    const shortId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;
    let jobId = shortId;
    let suffix = 1;
    while (used.has(jobId)) {
      jobId = `${shortId}-${suffix}`;
      suffix++;
    }
    used.add(jobId);
    map.set(step.id, jobId);
  }

  return map;
}

/**
 * Map Sverka triggers to GitHub triggers.
 * Multiple entries of the same kind have their branch filters merged.
 */
function lowerTriggers(entries: readonly EntryDefinition[]): GithubTriggers {
  const pushBranches = new Set<string>();
  let pushAll = false;
  const prBranches = new Set<string>();
  let prAll = false;
  let hasManual = false;

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        collectBranches(t, pushBranches, () => (pushAll = true));
        break;
      case "changeRequest":
        collectBranches(t, prBranches, () => (prAll = true));
        break;
      case "manual":
        hasManual = true;
        break;
      default:
        throw new GithubTargetError(
          `unsupported trigger kind: ${JSON.stringify((t as Trigger).kind)}`,
          "UNSUPPORTED_TRIGGER",
        );
    }
  }

  return assembleTriggers(
    pushAll,
    pushBranches,
    prAll,
    prBranches,
    hasManual,
  );
}

function collectBranches(
  t: Trigger,
  branches: Set<string>,
  markAll: () => void,
): void {
  if (t.filter?.branches && t.filter.branches.length > 0) {
    for (const branch of t.filter.branches) {
      branches.add(branch);
    }
  } else {
    markAll();
  }
}

function assembleTriggers(
  pushAll: boolean,
  pushBranches: Set<string>,
  prAll: boolean,
  prBranches: Set<string>,
  hasManual: boolean,
): GithubTriggers {
  const triggers: Record<string, unknown> = {};
  if (pushAll) {
    triggers.push = {};
  } else if (pushBranches.size > 0) {
    triggers.push = { branches: [...pushBranches] };
  }

  if (prAll) {
    triggers.pull_request = {};
  } else if (prBranches.size > 0) {
    triggers.pull_request = { branches: [...prBranches] };
  }

  if (hasManual) {
    triggers.workflow_dispatch = null;
  }

  return triggers as GithubTriggers;
}

/**
 * Lower reachable steps to GitHub jobs. One job per step.
 */
function lowerSteps(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
): readonly GithubJob[] {
  return steps.map((step) => lowerStep(step, jobIdMap));
}

/**
 * Lower a single Step to a GitHub job.
 */
function lowerStep(step: StepDefinition, jobIdMap: Map<string, string>): GithubJob {
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const steps = lowerOperations(step);
  const jobId = jobIdMap.get(step.id) ?? step.id;

  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";
  const runsOn = "ubuntu-latest";
  const container = resolveContainer(step, mode);
  const jobEnv = collectJobEnv(runtime);

  const job: GithubJob = {
    id: jobId,
    name: jobId,
    runsOn,
    needs,
    steps,
    ...(step.timeout !== undefined
      ? { timeoutMinutes: Math.ceil(step.timeout / 60000) }
      : {}),
    ...(Object.keys(jobEnv).length > 0 ? { env: jobEnv } : {}),
    ...(container ? { container } : {}),
  };

  return job;
}

function resolveContainer(
  step: StepDefinition,
  mode: string,
): string | undefined {
  if (mode === "container" && !step.runtime.image) {
    throw new GithubTargetError(
      `step '${step.id}' uses container mode without an image`,
      "LOWER_FAILED",
    );
  }
  return mode === "container" ? step.runtime.image : undefined;
}

function collectJobEnv(runtime: StepDefinition["runtime"]): Record<string, string> {
  const jobEnv: Record<string, string> = {};
  if (runtime.env) {
    Object.assign(jobEnv, runtime.env);
  }
  if (runtime.secrets) {
    for (const secret of runtime.secrets) {
      jobEnv[secret] = `\${{ secrets.${secret} }}`;
    }
  }
  return jobEnv;
}

/**
 * Map dependencies to job needs.
 * All dependency kinds create needs (GitHub jobs can't share values without artifacts).
 */
function lowerDependencies(
  deps: readonly Dependency[],
  jobIdMap: Map<string, string>,
): readonly string[] {
  const needs = new Set<string>();
  for (const dep of deps) {
    // Map full step ID to GitHub job ID.
    const jobId = jobIdMap.get(dep.producer);
    if (!jobId) {
      throw new GithubTargetError(
        `step depends on unknown producer '${dep.producer}'`,
        "INVALID_GRAPH",
      );
    }
    needs.add(jobId);
  }
  return [...needs];
}

/**
 * Map operations to GitHub steps in original order.
 * Consecutive shell/exportOutput operations are combined into one run step.
 */
function lowerOperations(step: StepDefinition): readonly GithubStep[] {
  const steps: GithubStep[] = [];
  const shortStepId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;

  // Every job needs the repository checked out.
  steps.push({
    name: "Checkout",
    uses: "actions/checkout@v4",
  });

  let runLines: string[] = [];

  function flushRun(): void {
    if (runLines.length === 0) return;
    steps.push({
      run: runLines.join("\n"),
    });
    runLines = [];
  }

  for (const op of step.operations) {
    lowerOperation(op, shortStepId, steps, runLines, flushRun);
  }

  flushRun();
  return steps;
}

function lowerOperation(
  op: OperationDefinition,
  shortStepId: string,
  steps: GithubStep[],
  runLines: string[],
  flushRun: () => void,
): void {
  switch (op.kind) {
    case "shell":
      runLines.push(op.command);
      break;
    case "exportOutput":
      runLines.push(`echo "${op.name}=\${${op.name}}" >> "$GITHUB_OUTPUT"`);
      break;
    case "exportArtifact":
      flushRun();
      steps.push({
        name: `Upload ${op.name}`,
        uses: "actions/upload-artifact@v4",
        with: { name: artifactName(shortStepId, op.name), path: op.path },
      });
      break;
    case "importArtifact":
      lowerImportArtifact(op, steps, flushRun);
      break;
    case "diagnostic":
      lowerDiagnostic(op, steps, flushRun);
      break;
    default:
      throw new GithubTargetError(
        `unsupported operation kind: ${JSON.stringify((op as OperationDefinition).kind)}`,
        "LOWER_FAILED",
      );
  }
}

function lowerImportArtifact(op: Extract<OperationDefinition, { kind: "importArtifact" }>, steps: GithubStep[], flushRun: () => void): void {
  flushRun();
  const fromShort = op.from.includes("/") ? op.from.split("/").pop()! : op.from;
  steps.push({
    name: `Download ${op.output}`,
    uses: "actions/download-artifact@v4",
    with: { name: artifactName(fromShort, op.output), path: op.output },
  });
}

function lowerDiagnostic(op: Extract<OperationDefinition, { kind: "diagnostic" }>, steps: GithubStep[], flushRun: () => void): void {
  flushRun();
  const severityFlag = severityFlagFor(op.severity);
  const escapedMessage = op.message
    .replaceAll("%", "%25")
    .replaceAll("\r\n", "%0D%0A")
    .replaceAll("\n", "%0A")
    .replaceAll("\r", "%0D");
  steps.push({
    env: { SVERKA_DIAGNOSTIC_MESSAGE: escapedMessage },
    run: String.raw`printf '%s\n' "::${severityFlag}::$SVERKA_DIAGNOSTIC_MESSAGE"`,
  });
}

/**
 * Generate a deterministic artifact name from step ID and output name.
 */
function artifactName(stepId: string, outputName: string): string {
  return `${stepId}-${outputName}`;
}

/**
 * Collect pipeline-level env vars from inputs.
 * Secret inputs are referenced via `${{ secrets.<name> }}` instead of
 * literal defaults.
 */
function collectEnv(pipeline: PipelineDefinition): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, input] of Object.entries(pipeline.inputs)) {
    if (input.secret) {
      env[name] = `\${{ secrets.${name} }}`;
    } else if (input.default !== undefined) {
      env[name] = String(input.default);
    }
  }
  return env;
}

function severityFlagFor(severity: string): string {
  if (severity === "error") return "error";
  if (severity === "warn") return "warning";
  return "notice";
}
