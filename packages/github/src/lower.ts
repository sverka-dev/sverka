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
 * One GitHub job per Step. Triggers collected from all entries.
 */
export function lowerGithub(graph: DefinitionGraph): GithubTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new GithubTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  // For v0, lower the first pipeline (multi-pipeline is future).
  const pipeline = graph.project.pipelines[0]!;

  // Build a mapping from full step IDs to GitHub-safe job IDs.
  const jobIdMap = buildJobIdMap(pipeline.steps);

  const triggers = lowerTriggers(pipeline.entries);
  const jobs = lowerSteps(pipeline.steps, jobIdMap);

  return {
    name: pipeline.id,
    on: triggers,
    jobs,
    env: collectEnv(pipeline),
  };
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
 */
function lowerTriggers(entries: readonly EntryDefinition[]): GithubTriggers {
  const triggers: {
    push?: { branches?: readonly string[] };
    pull_request?: { branches?: readonly string[] };
    workflow_dispatch?: null;
  } = {};

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        triggers.push = {
          ...(t.filter?.branches ? { branches: [...t.filter.branches] } : {}),
        };
        break;
      case "changeRequest":
        triggers.pull_request = {
          ...(t.filter?.branches ? { branches: [...t.filter.branches] } : {}),
        };
        break;
      case "manual":
        triggers.workflow_dispatch = null;
        break;
      default:
        throw new GithubTargetError(
          `unsupported trigger kind: ${(t as Trigger).kind}`,
          "UNSUPPORTED_TRIGGER",
        );
    }
  }

  return triggers;
}

/**
 * Lower steps to GitHub jobs. One job per step.
 */
function lowerSteps(steps: readonly StepDefinition[], jobIdMap: Map<string, string>): readonly GithubJob[] {
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
  const container = mode === "container" ? runtime.image : undefined;

  const job: GithubJob = {
    id: jobId,
    name: jobId,
    runsOn,
    needs,
    steps,
    ...(step.timeout !== undefined ? { timeoutMinutes: Math.ceil(step.timeout / 60000) } : {}),
    ...(runtime.env ? { env: { ...runtime.env } } : {}),
    ...(container ? { container } : {}),
  };

  return job;
}

/**
 * Map dependencies to job needs.
 * All dependency kinds create needs (GitHub jobs can't share values without artifacts).
 */
function lowerDependencies(deps: readonly Dependency[], jobIdMap: Map<string, string>): readonly string[] {
  const needs = new Set<string>();
  for (const dep of deps) {
    // Map full step ID to GitHub job ID.
    const jobId = jobIdMap.get(dep.producer) ?? dep.producer;
    needs.add(jobId);
  }
  return [...needs];
}

/**
 * Map operations to GitHub steps.
 * Always starts with checkout for artifact-aware steps.
 */
function lowerOperations(step: StepDefinition): readonly GithubStep[] {
  const steps: GithubStep[] = [];
  // Use the short ID for artifact naming (strip pipeline prefix).
  const shortStepId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;

  // Add checkout if the step has artifact imports (needs repo context).
  const hasImports = step.operations.some((op) => op.kind === "importArtifact");
  if (hasImports) {
    steps.push({
      name: "Checkout",
      uses: "actions/checkout@v4",
    });
  }

  // Add download-artifact steps for imports.
  for (const op of step.operations) {
    if (op.kind === "importArtifact") {
      const fromShort = op.from.includes("/") ? op.from.split("/").pop()! : op.from;
      steps.push({
        name: `Download ${op.output}`,
        uses: "actions/download-artifact@v4",
        with: {
          name: artifactName(fromShort, op.output),
          path: op.output,
        },
      });
    }
  }

  // Map shell and other operations.
  const shellCommands: string[] = [];
  for (const op of step.operations) {
    switch (op.kind) {
      case "shell":
        shellCommands.push(op.command);
        break;
      case "exportOutput":
        // Scalar output via $GITHUB_OUTPUT
        steps.push({
          id: `output-${op.name}`,
          run: `echo "${op.name}=${"$"}{${op.name}}" >> "$GITHUB_OUTPUT"`,
        });
        break;
      case "exportArtifact":
        steps.push({
          name: `Upload ${op.name}`,
          uses: "actions/upload-artifact@v4",
          with: {
            name: artifactName(shortStepId, op.name),
            path: op.path,
          },
        });
        break;
      case "importArtifact":
        // Already handled above
        break;
      case "diagnostic": {
        const cmd = op.severity === "error"
          ? `echo "::error::${op.message}`
          : op.severity === "warn"
            ? `echo "::warning::${op.message}`
            : `echo "::notice::${op.message}`;
        steps.push({ run: cmd });
        break;
      }
    }
  }

  // Combine consecutive shell commands into one step.
  if (shellCommands.length > 0) {
    steps.push({
      run: shellCommands.join("\n"),
    });
  }

  return steps;
}

/**
 * Generate a deterministic artifact name from step ID and output name.
 */
function artifactName(stepId: string, outputName: string): string {
  return `${stepId}-${outputName}`;
}

/**
 * Collect pipeline-level env vars from inputs.
 */
function collectEnv(pipeline: PipelineDefinition): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, input] of Object.entries(pipeline.inputs)) {
    if (input.default !== undefined) {
      env[name] = String(input.default);
    }
  }
  return env;
}
