// Native lowering: Definition Graph → GitlabTargetGraph.
// Spec 09 — §18.2, §19.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  EntryDefinition,
  OperationDefinition,
  Dependency,
  Trigger,
} from "@sverka/core";
import type { GitlabTargetGraph, GitlabJob, GitlabRule } from "./types.js";
import { GitlabTargetError } from "./errors.js";

const DOTENV_REPORT_FILE = "sverka.env";

/**
 * Lower a Definition Graph to a GitlabTargetGraph.
 * One GitLab job per reachable Step. Stages derived from dependency depth.
 */
export function lowerGitlab(graph: DefinitionGraph): GitlabTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new GitlabTargetError("graph has no pipelines", "INVALID_GRAPH");
  }
  if (graph.project.pipelines.length > 1) {
    throw new GitlabTargetError(
      "multi-pipeline graphs are not supported in v0",
      "INVALID_GRAPH",
    );
  }

  const pipeline = graph.project.pipelines[0]!;
  const reachableSteps = filterReachableSteps(pipeline);
  const jobIdMap = buildJobIdMap(reachableSteps);

  // Compute stages from topological levels.
  const { stageMap, stages } = computeStages(reachableSteps, jobIdMap);

  // Collect rules from entries.
  const rules = lowerTriggers(pipeline.entries);

  const jobs = lowerSteps(reachableSteps, jobIdMap, stageMap, rules);

  return {
    name: pipeline.id,
    stages,
    jobs,
    variables: collectVariables(pipeline),
  };
}

/**
 * Return the steps reachable from any entry root by following dependencies.
 */
function filterReachableSteps(
  pipeline: PipelineDefinition,
): readonly StepDefinition[] {
  if (pipeline.steps.length === 0) {
    return [];
  }

  const byId = new Map(pipeline.steps.map((step) => [step.id, step]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const entry of pipeline.entries) {
    for (const root of entry.roots) {
      if (byId.has(root) && !reachable.has(root)) {
        reachable.add(root);
        queue.push(root);
      }
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = byId.get(id);
    if (!step) continue;

    for (const dep of step.dependencies) {
      const producer = dep.producer;
      if (byId.has(producer) && !reachable.has(producer)) {
        reachable.add(producer);
        queue.push(producer);
      }
    }
  }

  return pipeline.steps.filter((step) => reachable.has(step.id));
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

interface StageResult {
  readonly stageMap: ReadonlyMap<string, string>;
  readonly stages: readonly string[];
}

/**
 * Compute stages by topological level.
 * Level 0 → "build", Level N → "stage-N".
 * Returns stages in dependency order (build first, then stage-1, etc.).
 * Throws when a dependency cycle is detected.
 */
function computeStages(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
): StageResult {
  const levels = new Map<string, number>();

  // Build dependency graph using job IDs.
  const depsByJob = new Map<string, string[]>();
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const deps = step.dependencies.map(
      (d) => jobIdMap.get(d.producer) ?? d.producer,
    );
    depsByJob.set(jobId, deps);
  }

  // Compute levels iteratively.
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const level = computeLevel(jobId, depsByJob, levels, new Set());
    levels.set(jobId, level);
  }

  // Derive ordered stage list from used levels.
  const maxLevel = Math.max(0, ...levels.values());
  const usedLevels = new Set(levels.values());
  const stages: string[] = [];
  for (let level = 0; level <= maxLevel; level++) {
    if (usedLevels.has(level)) {
      stages.push(level === 0 ? "build" : `stage-${level}`);
    }
  }

  // Map job IDs to stage names.
  const stageMap = new Map<string, string>();
  for (const [jobId, level] of levels) {
    stageMap.set(jobId, level === 0 ? "build" : `stage-${level}`);
  }

  return { stageMap, stages };
}

function computeLevel(
  jobId: string,
  depsByJob: Map<string, string[]>,
  levels: Map<string, number>,
  visiting: Set<string>,
): number {
  if (levels.has(jobId)) return levels.get(jobId)!;
  if (visiting.has(jobId)) {
    throw new GitlabTargetError(
      `dependency cycle detected involving job '${jobId}'`,
      "LOWER_FAILED",
    );
  }
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
 * Branch filters are preserved in the generated `if` expressions.
 */
function lowerTriggers(entries: readonly EntryDefinition[]): readonly GitlabRule[] {
  const rules: GitlabRule[] = [];

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        rules.push({
          if: buildSourceRule('$CI_PIPELINE_SOURCE == "push"', t.filter?.branches),
        });
        break;
      case "changeRequest":
        rules.push({
          if: buildSourceRule(
            '$CI_PIPELINE_SOURCE == "merge_request_event"',
            t.filter?.branches,
          ),
        });
        break;
      case "manual":
        rules.push({ if: '$CI_PIPELINE_SOURCE == "web"', when: "manual" });
        break;
      default:
        throw new GitlabTargetError(
          `unsupported trigger kind: ${JSON.stringify((t as Trigger).kind)}`,
          "UNSUPPORTED_TRIGGER",
        );
    }
  }

  return rules;
}

function buildSourceRule(
  sourceCondition: string,
  branches: readonly string[] | undefined,
): string {
  if (!branches || branches.length === 0) {
    return sourceCondition;
  }

  const branchCondition =
    branches.length === 1
      ? `$CI_COMMIT_BRANCH == ${JSON.stringify(branches[0])}`
      : `(${branches.map((b) => `$CI_COMMIT_BRANCH == ${JSON.stringify(b)}`).join(" || ")})`;

  return `${sourceCondition} && ${branchCondition}`;
}

/**
 * Lower steps to GitLab jobs.
 */
function lowerSteps(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
  stageMap: ReadonlyMap<string, string>,
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
  stageMap: ReadonlyMap<string, string>,
  rules: readonly GitlabRule[],
): GitlabJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const stage = stageMap.get(jobId) ?? "build";
  const { script, artifacts, needs: importNeeds, variables } = lowerOperations(
    step,
    jobIdMap,
  );

  // Merge explicit scheduling dependencies with artifact-import dependencies.
  const needs = [
    ...new Set([
      ...lowerDependencies(step.dependencies, jobIdMap),
      ...importNeeds,
    ]),
  ];

  if (script.length === 0) {
    script.push("echo 'no operations'");
  }

  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";

  if (mode === "container" && !runtime.image) {
    throw new GitlabTargetError(
      `step '${step.id}' uses container mode without an image`,
      "LOWER_FAILED",
    );
  }
  const image = mode === "container" ? runtime.image : undefined;

  const jobVariables: Record<string, string> = { ...variables };
  if (runtime.env) {
    Object.assign(jobVariables, runtime.env);
  }
  if (runtime.secrets) {
    for (const secret of runtime.secrets) {
      jobVariables[secret] = `$${secret}`;
    }
  }

  return {
    id: jobId,
    stage,
    needs,
    script,
    ...(image ? { image } : {}),
    ...(artifacts ? { artifacts } : {}),

    ...(Object.keys(jobVariables).length > 0 ? { variables: jobVariables } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    ...(step.timeout !== undefined
      ? { timeout: `${Math.ceil(step.timeout / 60000)}m` }
      : {}),
  };
}

/**
 * Map dependencies to job needs.
 */
function lowerDependencies(
  deps: readonly Dependency[],
  jobIdMap: Map<string, string>,
): readonly string[] {
  const needs = new Set<string>();
  for (const dep of deps) {
    const jobId = jobIdMap.get(dep.producer) ?? dep.producer;
    needs.add(jobId);
  }
  return [...needs];
}

/**
 * Map operations to script entries, artifacts, and dependencies.
 * Scalar outputs are written to a dotenv report file.
 */
function lowerOperations(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): {
  script: string[];
  artifacts?: { paths?: string[]; reports?: { dotenv?: string } };
  needs: string[];
  variables: Record<string, string>;
} {
  const script: string[] = [];
  const artifactPaths: string[] = [];
  const importNeeds: string[] = [];
  const jobVariables: Record<string, string> = {};
  let hasDotenv = false;

  for (const op of step.operations) {
    switch (op.kind) {
      case "shell":
        script.push(op.command);
        break;
      case "exportOutput": {
        const name = shellEscapeDoubleQuoted(op.name);
        script.push(
          `echo "${name}=\${${op.name}}" >> ${DOTENV_REPORT_FILE}`,
        );
        hasDotenv = true;
        break;
      }
      case "exportArtifact":
        artifactPaths.push(op.path);
        break;
      case "importArtifact": {
        const producerJob = jobIdMap.get(op.from) ?? op.from;
        importNeeds.push(producerJob);
        break;
      }
      case "diagnostic": {
        script.push(`echo ${shellQuoteSingle(op.message)}`);
        break;
      }
      default:
        throw new GitlabTargetError(
          `unsupported operation kind: ${JSON.stringify((op as OperationDefinition).kind)}`,
          "LOWER_FAILED",
        );
    }
  }

  const artifacts: { paths?: string[]; reports?: { dotenv?: string } } = {};
  if (artifactPaths.length > 0) {
    artifacts.paths = artifactPaths;
  }
  if (hasDotenv) {
    artifacts.reports = { dotenv: DOTENV_REPORT_FILE };
  }

  return {
    script,
    ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
    needs: importNeeds,
    variables: jobVariables,
  };
}

/**
 * Escape a string for use inside double quotes in a POSIX shell.
 */
function shellEscapeDoubleQuoted(value: string): string {
  return value.replace(/[\\"`$]/g, "\\$&");
}

/**
 * Quote a literal string using single quotes for a POSIX shell.
 */
function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Collect pipeline-level variables from inputs.
 * Secret inputs are omitted from the generated variables block.
 */
function collectVariables(pipeline: PipelineDefinition): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, input] of Object.entries(pipeline.inputs)) {
    if (input.secret) {
      continue;
    }
    if (input.default !== undefined) {
      vars[name] = String(input.default);
    }
  }
  return vars;
}
