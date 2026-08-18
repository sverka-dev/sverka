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
  Reference,
} from "@sverka/core";
import type { MatrixSpec, MatrixValue } from "@sverka/cdk";
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

  // Derive per-job rules from the entries whose closure reaches that job.
  const jobRulesMap = buildJobRulesMap(pipeline, reachableSteps, jobIdMap);

  const jobs = lowerSteps(reachableSteps, jobIdMap, stageMap, jobRulesMap);

  return {
    name: pipeline.name ?? pipeline.id,
    stages,
    jobs,
    variables: collectVariables(pipeline),
  };
}

/**
 * Return the ids of all producer steps referenced by a step, including
 * explicit dependencies and artifact imports.
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
 * Compute the set of step IDs reachable from the given roots.
 * Throws INVALID_GRAPH for unknown roots or producers.
 */
function reachableStepIds(
  roots: readonly string[],
  pipeline: PipelineDefinition,
): Set<string> {
  const byId = new Map(pipeline.steps.map((step) => [step.id, step]));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const root of roots) {
    if (!byId.has(root)) {
      throw new GitlabTargetError(
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
      if (!byId.has(producer)) {
        throw new GitlabTargetError(
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
 * Return the steps reachable from any entry root by following dependencies
 * and artifact imports.
 */
function filterReachableSteps(
  pipeline: PipelineDefinition,
): readonly StepDefinition[] {
  if (pipeline.steps.length === 0) {
    for (const entry of pipeline.entries) {
      if (entry.roots.length > 0) {
        throw new GitlabTargetError(
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
 * Build a map from each job ID to the rules of entries that reach that job.
 */
function buildJobRulesMap(
  pipeline: PipelineDefinition,
  reachableSteps: readonly StepDefinition[],
  jobIdMap: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly GitlabRule[]> {
  const map = new Map<string, readonly GitlabRule[]>();
  const entryReachable = new Map<string, Set<string>>();

  for (const entry of pipeline.entries) {
    entryReachable.set(entry.id, reachableStepIds(entry.roots, pipeline));
  }

  for (const step of reachableSteps) {
    const rules: GitlabRule[] = [];
    for (const entry of pipeline.entries) {
      if (entryReachable.get(entry.id)?.has(step.id)) {
        rules.push(...lowerTriggers([entry]));
      }
    }
    const jobId = jobIdMap.get(step.id)!;
    map.set(jobId, rules);
  }

  return map;
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
  const depsByJob = buildDepsByJob(steps, jobIdMap);
  const levels = computeAllLevels(steps, jobIdMap, depsByJob);
  return deriveStageResult(levels);
}

function buildDepsByJob(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
): Map<string, string[]> {
  // Build dependency graph using job IDs.
  const depsByJob = new Map<string, string[]>();
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const deps = producerIds(step).map((id) => jobIdMap.get(id) ?? id);
    depsByJob.set(jobId, deps);
  }
  return depsByJob;
}

function computeAllLevels(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
  depsByJob: Map<string, string[]>,
): Map<string, number> {
  const levels = new Map<string, number>();
  // Compute levels iteratively.
  for (const step of steps) {
    const jobId = jobIdMap.get(step.id) ?? step.id;
    const level = computeLevel(jobId, depsByJob, levels, new Set());
    levels.set(jobId, level);
  }
  return levels;
}

function stageNameForLevel(level: number): string {
  return level === 0 ? "build" : `stage-${level}`;
}

function deriveStageResult(levels: Map<string, number>): StageResult {
  // Derive ordered stage list from used levels.
  const maxLevel = Math.max(0, ...levels.values());
  const usedLevels = new Set(levels.values());
  const stages: string[] = [];
  for (let level = 0; level <= maxLevel; level++) {
    if (usedLevels.has(level)) {
      stages.push(stageNameForLevel(level));
    }
  }
  // Map job IDs to stage names.
  const stageMap = new Map<string, string>();
  for (const [jobId, level] of levels) {
    stageMap.set(jobId, stageNameForLevel(level));
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
        rules.push({ if: '$CI_PIPELINE_SOURCE == "web"' });
        break;
      case "schedule":
        rules.push({ if: '$CI_PIPELINE_SOURCE == "schedule"' });
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
      ? `$CI_COMMIT_BRANCH == ${quoteJsonString(branches[0]!)}`
      : `(${branches.map((b) => `$CI_COMMIT_BRANCH == ${quoteJsonString(b)}`).join(" || ")})`;

  return `${sourceCondition} && ${branchCondition}`;
}

/**
 * Lower steps to GitLab jobs.
 */
function lowerSteps(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
  stageMap: ReadonlyMap<string, string>,
  rulesMap: ReadonlyMap<string, readonly GitlabRule[]>,
): readonly GitlabJob[] {
  return steps.map((step) => lowerStep(step, jobIdMap, stageMap, rulesMap));
}

/**
 * Lower a single Step to a GitLab job.
 */
function lowerStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  stageMap: ReadonlyMap<string, string>,
  rulesMap: ReadonlyMap<string, readonly GitlabRule[]>,
): GitlabJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const stage = stageMap.get(jobId) ?? "build";
  const rules = rulesMap.get(jobId) ?? [];
  const { script, artifacts, needs: importNeeds, variables } = lowerOperations(
    step,
    jobIdMap,
    jobId,
  );

  const needs = mergeNeeds(step, jobIdMap, importNeeds);

  if (script.length === 0) {
    script.push("echo 'no operations'");
  }

  const { image, variables: jobVariables } = lowerRuntime(step, variables);

  return {
    id: jobId,
    stage,
    needs,
    script,
    ...buildJobFields(image, artifacts, jobVariables, rules, step.timeout),
    ...(step.matrix !== undefined
      ? { parallel: { matrix: lowerGitlabMatrix(step.matrix) } }
      : {}),
    ...(step.beforeScript ? { beforeScript: step.beforeScript } : {}),
    ...(step.afterScript ? { afterScript: step.afterScript } : {}),
    ...(step.continueOnError !== undefined
      ? {
          allowFailure:
            typeof step.continueOnError === "boolean"
              ? step.continueOnError
              : { exitCodes: step.continueOnError.exitCodes },
        }
      : {}),
    ...(step.retry !== undefined
      ? {
          retry: {
            max: step.retry.max,
            ...(step.retry.when ? { when: step.retry.when } : {}),
            ...(step.retry.exitCodes ? { exitCodes: step.retry.exitCodes } : {}),
          },
        }
      : {}),
  };
}

function mergeNeeds(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  importNeeds: readonly string[],
): string[] {
  // Merge explicit scheduling dependencies with artifact-import dependencies.
  return [
    ...new Set([
      ...lowerDependencies(step.dependencies, jobIdMap),
      ...importNeeds,
    ]),
  ];
}

function lowerRuntime(
  step: StepDefinition,
  baseVariables: Record<string, string>,
): { image?: string; variables: Record<string, string> } {
  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";

  if (mode === "container" && !runtime.image) {
    throw new GitlabTargetError(
      `step '${step.id}' uses container mode without an image`,
      "LOWER_FAILED",
    );
  }
  const image = mode === "container" ? runtime.image : undefined;

  const variables: Record<string, string> = { ...baseVariables };
  if (runtime.env) {
    Object.assign(variables, runtime.env);
  }
  if (runtime.secrets) {
    for (const secret of runtime.secrets) {
      variables[secret] = `$${secret}`;
    }
  }

  return { ...(image ? { image } : {}), variables };
}

function buildJobFields(
  image: string | undefined,
  artifacts: { paths?: string[]; reports?: { dotenv?: string } } | undefined,
  variables: Record<string, string>,
  rules: readonly GitlabRule[],
  timeout: number | undefined,
): Partial<GitlabJob> {
  return {
    ...(image ? { image } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
    ...(rules.length > 0 ? { rules } : {}),
    ...(timeout !== undefined
      ? { timeout: `${Math.ceil(timeout / 60000)}m` }
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
  jobId: string,
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
        script.push(translateGitlabCommand(op.command, step.inputs, jobIdMap));
        break;
      case "exportOutput": {
        const dotenvName = shellEscapeDoubleQuoted(`${jobId}_${op.name}`);
        script.push(
          `echo "${dotenvName}=\${${op.name}}" >> ${DOTENV_REPORT_FILE}`,
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
 * Produce a deterministic JSON string literal (quoted) for a value.
 */
function quoteJsonString(value: string): string {
  return `"${value.replace(/[\\"\n\r\t\b\f\u0000-\u001f]/g, (ch) => {
    const mapped = JSON_STRING_ESCAPES[ch];
    return mapped ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
  })}"`;
}

const JSON_STRING_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

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

// ---------------------------------------------------------------------------
// Matrix lowering (F-15)
// ---------------------------------------------------------------------------

type MatrixCombination = Record<string, MatrixValue>;

/**
 * Lower a MatrixSpec to a GitLab parallel:matrix array.
 * GitLab has no native include/exclude — exclude is emulated by filtering
 * combinations at synthesis time, include is appended to the array.
 */
function lowerGitlabMatrix(spec: MatrixSpec): readonly Record<string, unknown>[] {
  const combinations = computeMatrixCombinations(spec.dimensions, spec.exclude ?? []);
  const includeEntries = (spec.include ?? []).map((entry) => ({ ...entry }));
  // Keep values flat in the target graph; array-wrapping for GitLab's
  // parallel:matrix format happens at YAML emit time.
  return [
    ...combinations.map((c) => ({ ...c })),
    ...includeEntries,
  ];
}

/**
 * Compute the cross-product of matrix dimensions, then filter out
 * combinations matching any exclude rule (partial match).
 */
function computeMatrixCombinations(
  dimensions: Readonly<Record<string, readonly MatrixValue[]>>,
  exclude: readonly Readonly<Record<string, MatrixValue>>[],
): readonly MatrixCombination[] {
  const keys = Object.keys(dimensions);
  if (keys.length === 0) return [];

  let combinations: MatrixCombination[] = [{}];
  for (const key of keys) {
    const values = dimensions[key];
    if (!values || values.length === 0) {
      // A Cartesian product with an empty dimension produces zero combinations.
      return [];
    }
    const next: MatrixCombination[] = [];
    for (const combo of combinations) {
      for (const v of values) {
        next.push({ ...combo, [key]: v });
      }
    }
    combinations = next;
  }

  if (exclude.length === 0) return combinations;
  return combinations.filter((combo) => !matchesAny(combo, exclude));
}

/**
 * Check if a combination matches any exclude rule (partial match).
 */
function matchesAny(
  combo: MatrixCombination,
  rules: readonly Readonly<Record<string, MatrixValue>>[],
): boolean {
  for (const rule of rules) {
    const ruleEntries = Object.entries(rule);
    if (ruleEntries.length === 0) continue;
    if (ruleEntries.every(([k, v]) => combo[k] === v)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Context ref translation (F-35)
// ---------------------------------------------------------------------------

const GITLAB_CONTEXT_MAP: Readonly<Record<string, string>> = {
  "git.sha": "$CI_COMMIT_SHA",
  "git.branch": "$CI_COMMIT_BRANCH",
  "git.tag": "$CI_COMMIT_TAG",
  "change.id": "$CI_MERGE_REQUEST_IID",
  "change.source": "$CI_PIPELINE_SOURCE",
  "change.target": "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
  "change.draft": "$CI_MERGE_REQUEST_DRAFT",
  "event.type": "$CI_PIPELINE_SOURCE",
  "run.id": "$CI_PIPELINE_ID",
  // run.attempt has no GitLab equivalent; left unmapped.
};

function translateGitlabContextRef(namespace: string, field: string): string {
  const key = `${namespace}.${field}`;
  const mapped = GITLAB_CONTEXT_MAP[key];
  if (mapped) return mapped;
  if (namespace === "env" || namespace === "secrets" || namespace === "inputs") {
    return `$${field}`;
  }
  if (namespace === "matrix") {
    return `$${field.toUpperCase()}`;
  }
  return `\${${namespace}.${field}}`;
}

function translateGitlabCommand(
  command: string,
  inputs: readonly Reference[],
  jobIdMap: Map<string, string>,
): string {
  const lookup = new Map<string, Reference>();
  for (const ref of inputs) {
    if (ref.kind === "context") {
      lookup.set(`${ref.namespace}.${ref.field}`, ref);
    } else if (ref.kind === "step") {
      lookup.set(`${ref.step}.${ref.output}`, ref);
    }
  }
  return command.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const ref = lookup.get(key);
    if (ref === undefined) {
      return `\${${key}}`;
    }
    if (ref.kind === "context") {
      return translateGitlabContextRef(ref.namespace, ref.field);
    }
    // Use the producer job ID as a prefix to avoid collisions when
    // multiple producers expose the same output name.
    const producerJob = jobIdMap.get(ref.step) ?? ref.step;
    return `$${producerJob}_${ref.output}`;
  });
}
