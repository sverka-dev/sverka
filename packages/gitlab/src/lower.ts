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
  Expression,
  ComponentRef,
} from "@sverka/core";
import { expandPipelineCalls } from "@sverka/core";
import type { MatrixSpec, MatrixValue, StepRef, StatusCondition, Input, ServiceContainer, EnvironmentSpec, CacheSpec, ConcurrencySpec, InputLiteral } from "@sverka/cdk";
import type { GitlabTargetGraph, GitlabJob, GitlabRule, GitlabDefault, GitlabSpecInput, GitlabService, GitlabEnvironment, GitlabCache, GitlabComponentInclude, GitlabLocalInclude, GitlabTrigger, GitlabRelease, GitlabPages, GitlabWorkflowRule } from "./types.js";
import { GitlabTargetError } from "./errors.js";

const DOTENV_REPORT_FILE = "sverka.env";

/**
 * Lower a Definition Graph to a GitlabTargetGraph.
 * One GitLab job per reachable Step. Stages derived from dependency depth.
 * F-31: pipeline-call steps are inlined as namespaced jobs (v1; include:
 * file-reuse deferred).
 */
export function lowerGitlab(graph: DefinitionGraph): GitlabTargetGraph {
  if (graph.project.pipelines.length === 0) {
    throw new GitlabTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  // Multi-pipeline: lower each root pipeline (has entries), inlining call steps.
  // Single-pipeline: original behavior (with call expansion if present).
  const rootPipelines = graph.project.pipelines.filter(
    (p) => p.entries.length > 0,
  );
  if (rootPipelines.length === 0) {
    throw new GitlabTargetError("graph has no root pipelines (with entries)", "INVALID_GRAPH");
  }

  // For v1, lower the first root pipeline (single .gitlab-ci.yml).
  // Multi-root GitLab is a follow-up. Report dropped roots via console warning.
  if (rootPipelines.length > 1) {
    const dropped = rootPipelines.slice(1).map((p) => p.id);
    console.warn(`GitLab lowering: dropping ${dropped.length} additional root pipeline(s): ${dropped.join(", ")}. Multi-root GitLab support is not yet implemented.`);
  }
  const pipeline = rootPipelines[0]!;
  const reachableSteps = filterReachableSteps(pipeline);
  // Expand pipeline-call steps into inline namespaced jobs.
  const expandedSteps = expandPipelineCalls(graph, reachableSteps);

  // Collect component includes (F-32). Component steps become include entries,
  // not jobs. Filter them out of the job-producing step list.
  const includes: GitlabComponentInclude[] = [];
  const stepsForJobs = expandedSteps.filter((step) => {
    if (step.component) {
      includes.push(lowerComponentInclude(step.component));
      return false;
    }
    return true;
  });

  const jobIdMap = buildJobIdMap(stepsForJobs);

  // Compute stages from topological levels.
  const { stageMap, stages } = computeStages(stepsForJobs, jobIdMap);

  // Derive per-job rules from the entries whose closure reaches that job.
  const jobRulesMap = buildJobRulesMap(pipeline, stepsForJobs, jobIdMap);

  const jobs = lowerSteps(stepsForJobs, jobIdMap, stageMap, jobRulesMap);

  // F-42: lower pipeline rules to workflow rules.
  const workflowRules = lowerWorkflowRules(pipeline);

  // F-44: lower pipeline includes to local includes.
  const localIncludes = lowerLocalIncludes(pipeline);

  // Apply pipeline-level concurrency to all jobs as resource_group.
  if (pipeline.concurrency !== undefined) {
    const group = pipeline.concurrency.group;
    for (const job of jobs) {
      if (job.resourceGroup === undefined) {
        (job as { resourceGroup?: string }).resourceGroup = group;
      }
    }
  }

  // Emit workflow:auto_cancel when any reachable step is interruptible.
  const autoCancel = jobs.some((job) => job.interruptible === true);

  return {
    name: pipeline.id,
    stages,
    jobs,
    variables: collectVariables(pipeline),
    ...(autoCancel ? { autoCancel: true } : {}),
    ...(pipeline.defaults !== undefined ? { default: lowerDefault(pipeline.defaults) } : {}),
    ...(Object.keys(pipeline.inputs).length > 0 ? { specInputs: lowerSpecInputs(pipeline.inputs) } : {}),
    includes,
    ...(localIncludes.length > 0 ? { localIncludes } : {}),
    ...(workflowRules.length > 0 ? { workflowRules } : {}),
  };
}

/**
 * Lower pipeline inputs to GitLab spec:inputs.
 * choice type → type: string with options.
 */
function lowerSpecInputs(inputs: Readonly<Record<string, Input>>): Readonly<Record<string, GitlabSpecInput>> {
  const result: Record<string, GitlabSpecInput> = {};
  for (const [name, input] of Object.entries(inputs)) {
    result[name] = {
      type: input.type === "choice" ? "string" : input.type,
      ...(input.description !== undefined ? { description: input.description } : {}),
      // Omit defaults for secret inputs — they must not appear in the YAML.
      ...(input.default !== undefined && !input.secret ? { default: input.default } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      // GitLab spec:inputs uses `regex`, not `pattern`.
      ...(input.pattern !== undefined ? { regex: input.pattern } : {}),
    };
  }
  return result;
}

/**
 * Lower pipeline defaults to GitLab default keyword.
 * shell/workdir are not supported by GitLab and are dropped.
 */
function lowerDefault(defaults: {
  beforeScript?: readonly string[];
  afterScript?: readonly string[];
  timeout?: number;
  retry?: { max: number; exitCodes?: readonly number[] };
  interruptible?: boolean;
}): GitlabDefault {
  return {
    ...(defaults.beforeScript !== undefined ? { beforeScript: defaults.beforeScript } : {}),
    ...(defaults.afterScript !== undefined ? { afterScript: defaults.afterScript } : {}),
    ...(defaults.timeout !== undefined
      ? { timeout: `${Math.ceil(defaults.timeout / 60000)}m` }
      : {}),
    ...(defaults.retry !== undefined ? { retry: defaults.retry } : {}),
    ...(defaults.interruptible !== undefined ? { interruptible: defaults.interruptible } : {}),
  };
}

/**
 * Lower pipeline-level includes to GitLab local include directives.
 * F-44: includes → include: - local: <path>
 */
function lowerLocalIncludes(pipeline: PipelineDefinition): readonly GitlabLocalInclude[] {
  if (!pipeline.includes || pipeline.includes.length === 0) return [];
  return pipeline.includes.map((inc) => ({
    local: inc.path,
    ...(inc.inputs ? { inputs: { ...inc.inputs } } : {}),
  }));
}

/**
 * Lower pipeline-level rules to GitLab workflow:rules.
 * F-42: direct 1:1 mapping since GitLab has native support.
 */
function lowerWorkflowRules(pipeline: PipelineDefinition): readonly GitlabWorkflowRule[] {
  if (!pipeline.rules || pipeline.rules.length === 0) return [];
  return pipeline.rules.map((rule) => ({
    ...(rule.if ? { if: rule.if } : {}),
    ...(rule.changes ? { changes: [...rule.changes] } : {}),
    ...(rule.exists ? { exists: [...rule.exists] } : {}),
    ...(rule.variables ? { variables: { ...rule.variables } } : {}),
    ...(rule.when ? { when: rule.when } : {}),
  }));
}

/**
 * Lower a ComponentRef to a GitLab CI/CD component include entry.
 */
function lowerComponentInclude(ref: ComponentRef): GitlabComponentInclude {
  const inputs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(ref.inputs)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value) {
      // Reference bindings — GitLab uses variable interpolation.
      const r = value as Reference;
      if (r.kind === "step") {
        inputs[name] = `$CI_JOB_${r.step.replace(/-/g, "_").toUpperCase()}_OUTPUT_${r.output}`;
      } else if (r.kind === "context") {
        inputs[name] = `$${r.field.toUpperCase()}`;
      }
    } else {
      inputs[name] = value;
    }
  }
  return {
    component: `${ref.name}@${ref.version}`,
    inputs,
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
        rules.push(buildFilterRule('$CI_PIPELINE_SOURCE == "push"', t.filter, false));
        break;
      case "changeRequest":
        // For MR triggers, $CI_COMMIT_BRANCH is not populated.
        // Use $CI_MERGE_REQUEST_TARGET_BRANCH_NAME for branch filters.
        rules.push(buildFilterRule('$CI_PIPELINE_SOURCE == "merge_request_event"', t.filter, true));
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

/**
 * Build a GitLab rule from a source condition and a trigger filter.
 * For push triggers: branches → $CI_COMMIT_BRANCH, tags → $CI_COMMIT_TAG
 * For MR triggers: branches → $CI_MERGE_REQUEST_TARGET_BRANCH_NAME (target branch)
 * Paths → changes: [paths] on the rule
 */
function buildFilterRule(
  sourceCondition: string,
  filter: { readonly branches?: readonly string[]; readonly tags?: readonly string[]; readonly paths?: readonly string[] } | undefined,
  isMergeRequest: boolean,
): GitlabRule {
  // Source condition (push/MR/web) is always required.
  const conditions: string[] = [sourceCondition];

  // Branch and tag filters are OR'd: a push to a matching branch OR a matching tag.
  // For MR triggers, only branch (target) filters apply; tags are not relevant.
  const refConditions: string[] = [];
  if (filter?.branches && filter.branches.length > 0) {
    const branchRef = isMergeRequest ? "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" : "$CI_COMMIT_BRANCH";
    refConditions.push(buildRefCondition(branchRef, filter.branches));
  }
  if (filter?.tags && filter.tags.length > 0 && !isMergeRequest) {
    refConditions.push(buildRefCondition("$CI_COMMIT_TAG", filter.tags));
  }
  if (refConditions.length === 1) {
    conditions.push(refConditions[0]!);
  } else if (refConditions.length > 1) {
    conditions.push(`(${refConditions.join(" || ")})`);
  }

  const rule: GitlabRule = { if: conditions.join(" && ") };
  if (filter?.paths && filter.paths.length > 0) {
    return { ...rule, changes: [...filter.paths] };
  }
  return rule;
}

function buildRefCondition(ref: string, values: readonly string[]): string {
  if (values.length === 1) {
    return `${ref} == ${quoteJsonString(values[0]!)}`;
  }
  const parts = values.map((v) => `${ref} == ${quoteJsonString(v)}`);
  return `(${parts.join(" || ")})`;
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
  return steps.map((step) => {
    if (step.childPipeline) {
      return lowerChildPipelineStep(step, jobIdMap, stageMap, rulesMap);
    }
    if (step.downstream) {
      return lowerDownstreamStep(step, jobIdMap, stageMap, rulesMap);
    }
    return lowerStep(step, jobIdMap, stageMap, rulesMap);
  });
}

/**
 * Lower a child pipeline step to a GitLab trigger job.
 * F-33: childPipeline → trigger: include: [{ artifact: <path>, job: <generator> }]
 */
function lowerChildPipelineStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  stageMap: ReadonlyMap<string, string>,
  rulesMap: ReadonlyMap<string, readonly GitlabRule[]>,
): GitlabJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const stage = stageMap.get(jobId) ?? "build";
  const rules = rulesMap.get(jobId) ?? [];
  const needs = step.dependencies
    .filter((d) => d.kind === "control")
    .map((d) => jobIdMap.get(d.producer) ?? d.producer);
  const cp = step.childPipeline!;
  const generatorJobId = jobIdMap.get(`${step.id.split("/").slice(0, -1).join("/")}/${cp.generator}`) ?? cp.generator;
  const trigger: GitlabTrigger = {
    include: [{ artifact: cp.artifact, job: generatorJobId }],
  };
  return {
    id: jobId,
    stage,
    needs,
    script: [],
    ...(rules.length > 0 ? { rules } : {}),
    trigger,
  };
}

/**
 * Lower a downstream step to a GitLab multi-project trigger job.
 * F-34: downstream → trigger: project: <project>, branch: <branch>, strategy: depend
 */
function lowerDownstreamStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  stageMap: ReadonlyMap<string, string>,
  rulesMap: ReadonlyMap<string, readonly GitlabRule[]>,
): GitlabJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const stage = stageMap.get(jobId) ?? "build";
  const rules = rulesMap.get(jobId) ?? [];
  const needs = step.dependencies
    .filter((d) => d.kind === "control")
    .map((d) => jobIdMap.get(d.producer) ?? d.producer);
  const ds = step.downstream!;
  const trigger: GitlabTrigger = {
    project: ds.project,
    ...(ds.branch ? { branch: ds.branch } : {}),
    strategy: "depend",
  };
  // Inputs become variables on the trigger job.
  const variables = lowerDownstreamVariables(ds.inputs);
  return {
    id: jobId,
    stage,
    needs,
    script: [],
    ...(rules.length > 0 ? { rules } : {}),
    trigger,
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
  };
}

/**
 * Lower downstream step inputs to GitLab trigger variables.
 */
function lowerDownstreamVariables(inputs: Readonly<Record<string, Reference | InputLiteral>> | undefined): Record<string, string> {
  const variables: Record<string, string> = {};
  if (!inputs) return variables;
  for (const [name, value] of Object.entries(inputs)) {
    variables[name] = lowerReferenceOrLiteral(value);
  }
  return variables;
}

/**
 * Lower a reference binding or literal value to a GitLab variable string.
 * Reference bindings use GitLab variable interpolation; literals are stringified.
 */
function lowerReferenceOrLiteral(value: Reference | InputLiteral): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value) {
    const r = value as Reference;
    if (r.kind === "step") {
      return `$CI_JOB_${r.step.replace(/-/g, "_").toUpperCase()}_OUTPUT_${r.output}`;
    }
    if (r.kind === "context") {
      return `$${r.field.toUpperCase()}`;
    }
  }
  return String(value);
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
  const triggerRules = rulesMap.get(jobId) ?? [];
  const mergedRules = mergeRules(triggerRules, step.rules);
  const { script, artifacts, needs: importNeeds, variables, release, pages } = lowerOperations(
    step,
    jobId,
    jobIdMap,
  );

  const needs = mergeNeeds(step, jobIdMap, importNeeds);

  if (script.length === 0) {
    script.push("echo 'no operations'");
  }

  const { image, variables: jobVariables } = lowerRuntime(step, variables);
  const rules = applyStepCondition(mergedRules, step, jobIdMap);

  return {
    id: jobId,
    stage,
    needs,
    script,
    ...buildJobFields({ image, artifacts, variables: jobVariables, rules, timeout: step.timeout, interruptible: step.interruptible, runner: step.runner, identity: step.identity, services: step.services, environment: step.environment, cache: step.cache, concurrency: step.concurrency }),
    ...(step.matrix !== undefined
      ? { parallel: { matrix: lowerGitlabMatrix(step.matrix) } }
      : {}),
    ...(step.beforeScript ? { beforeScript: step.beforeScript } : {}),
    ...(step.afterScript ? { afterScript: step.afterScript } : {}),
    ...resolveContinueOnError(step),
    ...resolveRetryConfig(step),
    ...(release ? { release } : {}),
    ...(pages ? { pages } : {}),
    ...(step.delay ? { when: "delayed" as const, start_in: step.delay } : {}),
  };
}

/**
 * If the step has a condition, AND it with each rule's if expression.
 * GitLab evaluates rules in order and stops at the first match, so appending
 * the condition as a separate rule would bypass it when a trigger rule matches.
 */
function applyStepCondition(
  mergedRules: readonly GitlabRule[],
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): readonly GitlabRule[] {
  if (step.condition === undefined) return mergedRules;
  const condExpr = lowerGitlabConditionExpr(step.condition, jobIdMap);
  let rules = mergedRules.map((rule) => {
    if (condExpr === undefined) return rule;
    const ifExpr = rule.if !== undefined ? `(${rule.if}) && (${condExpr})` : condExpr;
    return { ...rule, if: ifExpr };
  });
  if (rules.length === 0 && condExpr !== undefined) {
    rules = [{ if: condExpr }];
  }
  return rules;
}

/** Resolve continueOnError to GitLab allowFailure field. */
function resolveContinueOnError(step: StepDefinition): Partial<GitlabJob> {
  if (step.continueOnError === undefined) return {};
  return {
    allowFailure:
      typeof step.continueOnError === "boolean"
        ? step.continueOnError
        : { exitCodes: step.continueOnError.exitCodes },
  };
}

/** Resolve retry configuration to GitLab retry field. */
function resolveRetryConfig(step: StepDefinition): Partial<GitlabJob> {
  if (step.retry === undefined) return {};
  return {
    retry: {
      max: step.retry.max,
      ...(step.retry.when ? { when: step.retry.when } : {}),
      ...(step.retry.exitCodes ? { exitCodes: step.retry.exitCodes } : {}),
    },
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

interface JobFieldContext {
  image: string | undefined;
  artifacts: { paths?: string[]; reports?: Record<string, unknown>; expireIn?: string; access?: string } | undefined;
  variables: Record<string, string>;
  rules: readonly GitlabRule[];
  timeout: number | undefined;
  interruptible: boolean | undefined;
  runner: { labels: readonly string[]; group?: string } | undefined;
  identity: { tokens: Readonly<Record<string, { audience: string }>> } | undefined;
  services: readonly ServiceContainer[] | undefined;
  environment: EnvironmentSpec | undefined;
  cache: CacheSpec | undefined;
  concurrency: ConcurrencySpec | undefined;
}

/** Build core job fields: image, artifacts, variables, rules. */
function buildJobCoreFields(ctx: JobFieldContext): Partial<GitlabJob> {
  return {
    ...(ctx.image ? { image: ctx.image } : {}),
    ...(ctx.artifacts ? { artifacts: ctx.artifacts } : {}),
    ...(Object.keys(ctx.variables).length > 0 ? { variables: ctx.variables } : {}),
    ...(ctx.rules.length > 0 ? { rules: ctx.rules } : {}),
  };
}

/** Build runtime/execution fields: timeout, interruptible, runner tags, id_tokens. */
function buildJobRuntimeFields(ctx: JobFieldContext): Partial<GitlabJob> {
  return {
    ...(ctx.timeout !== undefined
      ? { timeout: `${Math.ceil(ctx.timeout / 60000)}m` }
      : {}),
    ...(ctx.interruptible !== undefined ? { interruptible: ctx.interruptible } : {}),
    ...(ctx.runner !== undefined ? { tags: ctx.runner.labels } : {}),
    ...lowerIdTokens(ctx.identity),
  };
}

/** Build environment-related fields: services, environment, cache, concurrency. */
function buildJobEnvFields(ctx: JobFieldContext): Partial<GitlabJob> {
  return {
    ...(ctx.services !== undefined && ctx.services.length > 0
      ? { services: lowerGitlabServices(ctx.services) }
      : {}),
    ...(ctx.environment !== undefined ? { environment: lowerGitlabEnvironment(ctx.environment) } : {}),
    ...(ctx.cache !== undefined ? { cache: lowerGitlabCache(ctx.cache) } : {}),
    ...(ctx.concurrency !== undefined ? { resourceGroup: ctx.concurrency.group } : {}),
  };
}

function buildJobFields(ctx: JobFieldContext): Partial<GitlabJob> {
  return {
    ...buildJobCoreFields(ctx),
    ...buildJobRuntimeFields(ctx),
    ...buildJobEnvFields(ctx),
  };
}

/** Lower identity tokens to GitLab id_tokens field. */
function lowerIdTokens(identity: JobFieldContext["identity"]): Partial<Pick<GitlabJob, "idTokens">> {
  if (identity === undefined) return {};
  const idTokens: Record<string, { aud: string }> = {};
  for (const [name, spec] of Object.entries(identity.tokens)) {
    idTokens[name] = { aud: spec.audience };
  }
  return Object.keys(idTokens).length > 0 ? { idTokens } : {};
}

/**
 * Lower cache spec to GitLab cache keyword.
 */
function lowerGitlabCache(cache: CacheSpec): GitlabCache {
  return {
    paths: cache.paths,
    key: cache.key,
    ...(cache.policy !== undefined ? { policy: cache.policy } : {}),
    ...(cache.restoreKeys !== undefined ? { fallbackKeys: cache.restoreKeys } : {}),
  };
}

/**
 * Lower environment spec to GitLab environment map.
 */
function lowerGitlabEnvironment(env: EnvironmentSpec): GitlabEnvironment {
  return {
    name: env.name,
    ...(env.url !== undefined ? { url: env.url } : {}),
    ...(env.action !== undefined ? { action: env.action } : {}),
    ...(env.tier !== undefined ? { deploymentTier: env.tier } : {}),
  };
}

/**
 * Lower service containers to GitLab services array.
 * ports are not supported by GitLab and are dropped.
 */
function lowerGitlabServices(services: readonly ServiceContainer[]): readonly GitlabService[] {
  return services.map((svc) => ({
    name: svc.image,
    // Fall back to the portable service name so scripts can reach it by its declared name.
    alias: svc.alias ?? svc.name,
    ...(svc.entrypoint !== undefined ? { entrypoint: [...svc.entrypoint] } : {}),
    ...(svc.command !== undefined ? { command: [...svc.command] } : {}),
    ...(svc.env !== undefined ? { variables: { ...svc.env } } : {}),
  }));
}

/**
 * Merge trigger-derived rules with step-level rules.
 * Step-level rules are appended after trigger rules.
 */
function mergeRules(
  triggerRules: readonly GitlabRule[],
  stepRules: readonly { if?: string; changes?: readonly string[]; exists?: readonly string[]; when?: string; variables?: Readonly<Record<string, string>> }[] | undefined,
): readonly GitlabRule[] {
  if (stepRules === undefined || stepRules.length === 0) {
    return triggerRules;
  }
  const result: GitlabRule[] = [...triggerRules];
  for (const rule of stepRules) {
    const gitlabRule: GitlabRule = {
      ...(rule.if !== undefined ? { if: rule.if } : {}),
      ...(rule.when !== undefined ? { when: rule.when } : {}),
      ...(rule.changes !== undefined ? { changes: rule.changes } : {}),
      ...(rule.exists !== undefined ? { exists: rule.exists } : {}),
      ...(rule.variables !== undefined ? { variables: rule.variables } : {}),
    };
    result.push(gitlabRule);
  }
  return result;
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
 * Mutable accumulator for lowering operations.
 */
interface OperationAccumulator {
  readonly script: string[];
  readonly artifactPaths: string[];
  readonly importNeeds: string[];
  readonly reportEntries: Record<string, unknown>;
  readonly inputs: readonly Reference[];
  hasDotenv: boolean;
  artifactRetention: string | undefined;
  artifactAccess: string | undefined;
  release: GitlabRelease | undefined;
  pages: GitlabPages | undefined;
}

/**
 * Map operations to script entries, artifacts, and dependencies.
 * Scalar outputs are written to a dotenv report file.
 */
function lowerOperations(
  step: StepDefinition,
  jobId: string,
  jobIdMap: Map<string, string>,
): {
  script: string[];
  artifacts?: { paths?: string[]; reports?: Record<string, unknown>; expireIn?: string; access?: string };
  needs: string[];
  variables: Record<string, string>;
  release?: GitlabRelease;
  pages?: GitlabPages;
} {
  const acc: OperationAccumulator = {
    script: [],
    artifactPaths: [],
    importNeeds: [],
    reportEntries: {},
    inputs: step.inputs,
    hasDotenv: false,
    artifactRetention: undefined,
    artifactAccess: undefined,
    release: undefined,
    pages: undefined,
  };

  for (const op of step.operations) {
    lowerOperation(op, jobId, acc, jobIdMap);
  }

  return assembleOperationResult(acc, step);
}

/**
 * Lower a shell operation, handling background execution.
 */
function lowerShellOp(
  op: Extract<OperationDefinition, { kind: "shell" }>,
  acc: OperationAccumulator,
  jobIdMap: Map<string, string>,
): void {
  const translated = translateGitlabCommand(op.command, acc.inputs, jobIdMap);
  // F-49: background shell → append & for async execution.
  acc.script.push(op.background ? `${translated} &` : translated);
}

/**
 * Lower a single operation, mutating the accumulator.
 */
function lowerOperation(
  op: OperationDefinition,
  stepId: string,
  acc: OperationAccumulator,
  jobIdMap: Map<string, string>,
): void {
  switch (op.kind) {
    case "shell":
      lowerShellOp(op, acc, jobIdMap);
      break;
    case "exportOutput":
      lowerExportOutput(op, stepId, acc);
      break;
    case "exportArtifact":
      lowerExportArtifact(op, acc);
      break;
    case "importArtifact":
      acc.importNeeds.push(jobIdMap.get(op.from) ?? op.from);
      break;
    case "diagnostic":
      acc.script.push(`echo ${shellQuoteSingle(op.message)}`);
      break;
    case "report":
      lowerReport(op, acc);
      break;
    case "release":
      acc.release = lowerReleaseOp(op);
      break;
    case "deployPages":
      lowerDeployPages(op, acc);
      break;
    default:
      throw new GitlabTargetError(
        `unsupported operation kind: ${JSON.stringify((op as OperationDefinition).kind)}`,
        "LOWER_FAILED",
      );
  }
}

/**
 * Lower an exportOutput operation into a dotenv echo line.
 */
function lowerExportOutput(
  op: Extract<OperationDefinition, { kind: "exportOutput" }>,
  stepId: string,
  acc: OperationAccumulator,
): void {
  const key = `${stepId}_${op.name}`;
  const name = shellEscapeDoubleQuoted(key);
  acc.script.push(`echo "${name}=\${${op.name}}" >> ${DOTENV_REPORT_FILE}`);
  acc.hasDotenv = true;
}

/**
 * Lower an exportArtifact operation, recording paths and retention metadata.
 */
function lowerExportArtifact(
  op: Extract<OperationDefinition, { kind: "exportArtifact" }>,
  acc: OperationAccumulator,
): void {
  acc.artifactPaths.push(op.path);
  if (op.retention !== undefined) acc.artifactRetention = op.retention;
  if (op.access !== undefined) acc.artifactAccess = op.access;
}

/**
 * Lower a report operation into a GitLab artifacts:reports entry.
 */
function lowerReport(
  op: Extract<OperationDefinition, { kind: "report" }>,
  acc: OperationAccumulator,
): void {
  const key = gitlabReportKey(op.spec.type);
  if (op.spec.type === "coverage") {
    acc.reportEntries[key] = {
      coverage_format: op.spec.format ?? "cobertura",
      path: op.spec.path,
    };
  } else {
    acc.reportEntries[key] = op.spec.path;
  }
}

/**
 * Lower a release operation to a GitLab release keyword.
 * Assets are file paths → emit as links with placeholder URLs
 * (GitLab requires URLs, not file paths).
 */
function lowerReleaseOp(op: Extract<OperationDefinition, { kind: "release" }>): GitlabRelease {
  const links = (op.assets ?? []).map((path) => ({
    name: path.split("/").pop() ?? path,
    // Use GitLab CI job artifact URL variables so links resolve to the actual artifact.
    url: `$CI_PROJECT_URL/-/jobs/$CI_JOB_ID/artifacts/file/${path}`,
  }));
  return {
    tag_name: op.tag,
    ...(op.name ? { name: op.name } : {}),
    ...(op.description ? { description: op.description } : {}),
    ...(links.length > 0 ? { assets: { links } } : {}),
    ...(op.draft !== undefined ? { draft: op.draft } : {}),
  };
}

/**
 * Lower a deployPages operation to a GitLab pages keyword.
 * GitLab 17.6+ accepts any job name when the job sets the `pages` keyword.
 * The path is also added as an artifact.
 */
function lowerDeployPages(
  op: Extract<OperationDefinition, { kind: "deployPages" }>,
  acc: OperationAccumulator,
): void {
  acc.pages = {
    publish: op.path,
    ...(op.prefix ? { path_prefix: op.prefix } : {}),
  };
  // GitLab pages requires the path as an artifact.
  acc.artifactPaths.push(op.path);
}

/**
 * Assemble the final lowerOperations result from the accumulator.
 */
function assembleOperationResult(acc: OperationAccumulator, step: StepDefinition): {
  script: string[];
  artifacts?: { paths?: string[]; reports?: Record<string, unknown>; expireIn?: string; access?: string };
  needs: string[];
  variables: Record<string, string>;
  release?: GitlabRelease;
  pages?: GitlabPages;
} {
  const artifacts: { paths?: string[]; reports?: Record<string, unknown>; expireIn?: string; access?: string } = {};
  if (acc.artifactPaths.length > 0) {
    artifacts.paths = acc.artifactPaths;
  }
  if (acc.hasDotenv) {
    acc.reportEntries.dotenv = DOTENV_REPORT_FILE;
  }
  if (Object.keys(acc.reportEntries).length > 0) {
    artifacts.reports = acc.reportEntries;
  }
  if (acc.artifactRetention !== undefined) {
    artifacts.expireIn = parseGitlabExpireIn(acc.artifactRetention);
  }
  if (acc.artifactAccess !== undefined) {
    artifacts.access = acc.artifactAccess;
  }

  if (step.runtime.workingDir && acc.script.length > 0) {
    // Shell-quote the directory to prevent injection and handle spaces
    const escapedDir = shellQuoteSingle(step.runtime.workingDir);
    acc.script.unshift(`cd ${escapedDir}`);
  }

  return {
    script: acc.script,
    ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
    needs: acc.importNeeds,
    variables: {},
    ...(acc.release ? { release: acc.release } : {}),
    ...(acc.pages ? { pages: acc.pages } : {}),
  };
}

/**
 * Convert Sverka retention duration to GitLab expire_in format.
 * "7d" → "7 days", "1h" → "1 hours", "30m" → "30 minutes", "never" → "never".
 */
function parseGitlabExpireIn(retention: string): string {
  if (retention === "never") return "never";
  const match = /^(\d+)([dhm])$/.exec(retention);
  if (match === null) return retention;
  const value = match[1]!;
  const unit = match[2];
  if (unit === "d") return `${value} days`;
  if (unit === "h") return `${value} hours`;
  if (unit === "m") return `${value} minutes`;
  return retention;
}

/**
 * Map Sverka report type to GitLab artifacts:reports key.
 */
function gitlabReportKey(type: string): string {
  const map: Record<string, string> = {
    junit: "junit",
    coverage: "coverage_report",
    dotenv: "dotenv",
    sast: "sast",
    dast: "dast",
    dependencyScanning: "dependency_scanning",
    containerScanning: "container_scanning",
    licenseScanning: "license_scanning",
    performance: "performance",
    metrics: "metrics",
    terraform: "terraform",
    quality: "quality",
    sarif: "sast",
  };
  return map[type] ?? type;
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
  validateMatrixKeys(spec);
  const combinations = computeMatrixCombinations(spec.dimensions, spec.exclude ?? []);
  const totalRows = combinations.length + (spec.include?.length ?? 0);
  if (totalRows > 200) {
    throw new GitlabTargetError(
      `GitLab matrix has ${totalRows} rows, exceeding the 200-row limit`,
      "MATRIX_TOO_LARGE",
    );
  }
  const includeEntries = (spec.include ?? []).map((entry) => ({ ...entry }));
  return [...combinations.map((c) => ({ ...c })), ...includeEntries];
}

/**
 * Validate that matrix dimension and include keys contain only valid
 * GitLab variable name characters: letters, digits, underscores.
 */
function validateMatrixKeys(spec: MatrixSpec): void {
  const validKey = /^[A-Za-z_]\w*$/;
  for (const key of Object.keys(spec.dimensions)) {
    if (!validKey.test(key)) {
      throw new GitlabTargetError(
        String.raw`invalid matrix dimension key '${key}': must match [A-Za-z_]\w*`,
        "INVALID_MATRIX",
      );
    }
  }
  if (spec.include) {
    for (const entry of spec.include) {
      for (const key of Object.keys(entry)) {
        if (!validKey.test(key)) {
          throw new GitlabTargetError(
            String.raw`invalid matrix include key '${key}': must match [A-Za-z_]\w*`,
            "INVALID_MATRIX",
          );
        }
      }
    }
  }
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
    if (!values || values.length === 0) continue;
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
  "run.attempt": "$run_attempt",
};

/**
 * Translate a context ref (namespace.field) to GitLab variable syntax.
 */
function translateGitlabContextRef(namespace: string, field: string): string {
  const key = `${namespace}.${field}`;
  const mapped = GITLAB_CONTEXT_MAP[key];
  if (mapped) return mapped;
  // Dynamic namespaces: env.X, secrets.X, inputs.X → just $X
  if (namespace === "env" || namespace === "secrets") {
    return `$${field}`;
  }
  if (namespace === "matrix") {
    return `$${field.toUpperCase()}`;
  }
  // inputs.X → $[[ inputs.FIELD ]] (GitLab pipeline input syntax)
  if (namespace === "inputs") {
    return `$[[ inputs.${field} ]]`;
  }
  // Unknown — fail lowering rather than emit invalid expression
  throw new GitlabTargetError(
    `unsupported context namespace '${namespace}' in GitLab lowering`,
    "LOWER_FAILED",
  );
}

/**
 * Translate a step ref to GitLab variable syntax: $<output> (from dotenv artifact).
 */
function translateGitlabStepRef(ref: StepRef): string {
  return `$${ref.output}`;
}

/**
 * Build a lookup map from placeholder key to Reference from the step's inputs.
 */
function buildGitlabInputLookup(inputs: readonly Reference[]): Map<string, Reference> {
  const map = new Map<string, Reference>();
  for (const ref of inputs) {
    if (ref.kind === "context") {
      map.set(`${ref.namespace}.${ref.field}`, ref);
    } else if (ref.kind === "step") {
      map.set(`${ref.step}.${ref.output}`, ref);
    }
  }
  return map;
}

/**
 * Translate ${...} placeholders in a command string to GitLab variable syntax.
 */
function translateGitlabCommand(
  command: string,
  inputs: readonly Reference[],
  _jobIdMap: Map<string, string>,
): string {
  const lookup = buildGitlabInputLookup(inputs);
  return command.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const ref = lookup.get(key);
    if (ref === undefined) {
      return `\${${key}}`;
    }
    if (ref.kind === "context") {
      return translateGitlabContextRef(ref.namespace, ref.field);
    }
    return translateGitlabStepRef(ref);
  });
}

/**
 * Lower a step condition to a GitLab if: expression string (without wrapping in a rule).
 * Returns the raw expression that can be combined with trigger rule conditions.
 */
function lowerGitlabConditionExpr(
  condition: Reference | Expression | StatusCondition,
  _jobIdMap: Map<string, string>,
): string {
  if (condition.kind === "status") {
    // GitLab status conditions map to when: field, not if: expression.
    // Return a sentinel that the caller can use to set when: instead.
    // For if: expression purposes: success = no restriction, always = true, never = false.
    if (condition.status === "always") return "true";
    if (condition.status === "never") return "false";
    return ""; // success/failure — no if: restriction (when: handles it)
  }
  if (condition.kind === "context") {
    return translateGitlabContextRef(condition.namespace, condition.field);
  }
  if (condition.kind === "step") {
    // Step ref condition — truthiness check on the output variable
    return translateGitlabStepRef(condition);
  }
  // Expression — translate each ${...} placeholder, no single-quote wrapping
  const lookup = buildGitlabInputLookup(condition.refs);
  return condition.template.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const ref = lookup.get(key);
    if (ref === undefined) return `\${${key}}`;
    if (ref.kind === "context") {
      return translateGitlabContextRef(ref.namespace, ref.field);
    }
    return translateGitlabStepRef(ref);
  });
}

/**
 * Lower a step condition to a GitLab rule with an if: expression.
 */
function lowerGitlabCondition(
  condition: Reference | Expression | StatusCondition,
  jobIdMap: Map<string, string>,
): GitlabRule {
  return { if: lowerGitlabConditionExpr(condition, jobIdMap) };
}
