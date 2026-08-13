// Native lowering: Definition Graph → GitlabTargetGraph.
// Spec 09 — §18.2, §19.

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
  GitlabTargetGraph,
  GitlabJob,
  GitlabRule,
} from "./types.js";
import { GitlabTargetError } from "./errors.js";

/**
 * Lower a Definition Graph to a GitlabTargetGraph.
 * One GitLab job per Step. Stages derived from dependency depth.
 */
export function lowerGitlab(graph: DefinitionGraph): GitlabTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new GitlabTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  const pipeline = graph.project.pipelines[0]!;

  // Build job ID map (strip pipeline prefix).
  const jobIdMap = buildJobIdMap(pipeline.steps);

  // Compute stages from topological levels.
  const stageMap = computeStages(pipeline.steps, jobIdMap);

  // Collect rules from entries.
  const rules = lowerTriggers(pipeline.entries);

  const jobs = lowerSteps(pipeline.steps, jobIdMap, stageMap, rules);

  // Collect unique stage names in order.
  const stageOrder = [...new Set(jobs.map((j) => j.stage))];

  return {
    name: pipeline.id,
    stages: stageOrder,
    jobs,
    variables: collectVariables(pipeline),
  };
}

/**
 * Build a mapping from full step IDs to GitLab-safe job IDs.
 */
function buildJobIdMap(steps: readonly StepDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();

  for (const step of steps) {
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
 * Compute stages by topological level.
 * Level 0 → "build", Level N → "stage-N".
 */
function computeStages(steps: readonly StepDefinition[], jobIdMap: Map<string, string>): Map<string, string> {
  const levels = new Map<string, number>();

  // Build dependency graph using job IDs.
  const depsByJob = new Map<string, string[]>();
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const deps = step.dependencies.map((d) => jobIdMap.get(d.producer) ?? d.producer);
    depsByJob.set(jobId, deps);
  }

  // Compute levels iteratively.
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const level = computeLevel(jobId, depsByJob, levels, new Set());
    levels.set(jobId, level);
  }

  // Map level to stage name.
  const stageMap = new Map<string, string>();
  for (const [jobId, level] of levels) {
    stageMap.set(jobId, level === 0 ? "build" : `stage-${level}`);
  }

  return stageMap;
}

function computeLevel(
  jobId: string,
  depsByJob: Map<string, string[]>,
  levels: Map<string, number>,
  visiting: Set<string>,
): number {
  if (levels.has(jobId)) return levels.get(jobId)!;
  if (visiting.has(jobId)) return 0; // cycle protection
  visiting.add(jobId);

  const deps = depsByJob.get(jobId) ?? [];
  if (deps.length === 0) {
    visiting.delete(jobId);
    return 0;
  }

  let maxDepLevel = 0;
  for (const dep of deps) {
    const depLevel = computeLevel(dep, depsByJob, levels, visiting);
    maxDepLevel = Math.max(maxDepLevel, depLevel);
  }

  visiting.delete(jobId);
  return maxDepLevel + 1;
}

/**
 * Map Sverka triggers to GitLab rules.
 */
function lowerTriggers(entries: readonly EntryDefinition[]): readonly GitlabRule[] {
  const rules: GitlabRule[] = [];

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        rules.push({ if: '$CI_PIPELINE_SOURCE == "push"' });
        break;
      case "changeRequest":
        rules.push({ if: '$CI_PIPELINE_SOURCE == "merge_request_event"' });
        break;
      case "manual":
        rules.push({ if: '$CI_PIPELINE_SOURCE == "web"', when: "manual" });
        break;
      default:
        throw new GitlabTargetError(
          `unsupported trigger kind: ${(t as Trigger).kind}`,
          "UNSUPPORTED_TRIGGER",
        );
    }
  }

  return rules;
}

/**
 * Lower steps to GitLab jobs.
 */
function lowerSteps(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
  stageMap: Map<string, string>,
  rules: readonly GitlabRule[],
): readonly GitlabJob[] {
  return steps.map((step) => lowerStep(step, jobIdMap, stageMap, rules));
}

/**
 * Lower a single Step to a GitLab job.
 */
function lowerStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  stageMap: Map<string, string>,
  rules: readonly GitlabRule[],
): GitlabJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const stage = stageMap.get(jobId) ?? "build";
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const { script, artifacts, dependencies } = lowerOperations(step, needs);

  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";
  const image = mode === "container" ? runtime.image : undefined;

  return {
    id: jobId,
    stage,
    needs,
    script,
    ...(image ? { image } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(runtime.env ? { variables: { ...runtime.env } } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    ...(step.timeout !== undefined ? { timeout: `${Math.ceil(step.timeout / 60000)}m` } : {}),
  };
}

/**
 * Map dependencies to job needs.
 */
function lowerDependencies(deps: readonly Dependency[], jobIdMap: Map<string, string>): readonly string[] {
  const needs = new Set<string>();
  for (const dep of deps) {
    const jobId = jobIdMap.get(dep.producer) ?? dep.producer;
    needs.add(jobId);
  }
  return [...needs];
}

/**
 * Map operations to script entries, artifacts, and dependencies.
 */
function lowerOperations(
  step: StepDefinition,
  needs: readonly string[],
): {
  script: readonly string[];
  artifacts: readonly { paths: readonly string[] }[];
  dependencies: readonly string[];
} {
  const script: string[] = [];
  const artifactPaths: string[] = [];
  const importDeps: string[] = [];
  const shortStepId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;

  for (const op of step.operations) {
    switch (op.kind) {
      case "shell":
        script.push(op.command);
        break;
      case "exportOutput":
        script.push(`echo "${op.name}=\${${op.name}}" >> .env`);
        break;
      case "exportArtifact":
        artifactPaths.push(op.path);
        break;
      case "importArtifact": {
        const fromShort = op.from.includes("/") ? op.from.split("/").pop()! : op.from;
        importDeps.push(fromShort);
        break;
      }
      case "diagnostic":
        script.push(`echo "${op.message}"`);
        break;
    }
  }

  // Combine needs with import dependencies for the dependencies field.
  const allDeps = [...new Set([...needs, ...importDeps])];

  return {
    script,
    artifacts: artifactPaths.length > 0 ? [{ paths: [...artifactPaths] }] : [],
    dependencies: allDeps,
  };
}

/**
 * Collect pipeline-level variables from inputs.
 */
function collectVariables(pipeline: PipelineDefinition): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, input] of Object.entries(pipeline.inputs)) {
    if (input.default !== undefined) {
      vars[name] = String(input.default);
    }
  }
  return vars;
}
