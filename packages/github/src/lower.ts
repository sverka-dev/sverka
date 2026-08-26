// Native lowering: Definition Graph → GithubTargetGraph[].
// Spec 08 — §18.1, §19. F-31: multi-pipeline reusable workflows.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  EntryDefinition,
  OperationDefinition,
  Dependency,
  Reference,
  Expression,
  Input,
} from "@sverka/core";
import type { Trigger, MatrixSpec, StepRef, StatusCondition, PipelineDefaults, ReportSpec, ServiceContainer, CacheSpec, Rule } from "@sverka/cdk";
import type {
  GithubTargetGraph,
  GithubTriggers,
  GithubJob,
  GithubStep,
  GithubRunsOn,
  GithubDefaults,
  GithubDefaultsRun,
  GithubInput,
  GithubService,
} from "./types.js";
import { GithubTargetError } from "./errors.js";

/**
 * Lower a Definition Graph to one or more GithubTargetGraphs.
 * - Each pipeline with entries → a root workflow with its triggers.
 * - Each pipeline referenced by a call step → a reusable workflow with
 *   `on: workflow_call` (+ its own triggers if it also has entries).
 * - Call steps become `uses:` jobs.
 * Single-pipeline graphs (no calls) are unchanged (backward compat).
 */
export function lowerGithub(graph: DefinitionGraph): GithubTargetGraph | readonly GithubTargetGraph[] {
  if (graph.project.pipelines.length === 0) {
    throw new GithubTargetError("graph has no pipelines", "INVALID_GRAPH");
  }

  // Single-pipeline, no special steps → backward compat.
  if (graph.project.pipelines.length === 1) {
    const pipeline = graph.project.pipelines[0]!;
    const hasSpecial = pipeline.steps.some(
      (s) => s.call || s.component || s.childPipeline || s.downstream,
    );
    if (!hasSpecial) {
      return lowerSinglePipeline(pipeline);
    }
  }

  // Multi-pipeline or has special steps → lower all pipelines.
  return lowerMultiPipeline(graph);
}

/**
 * Lower a single pipeline (no calls) — original v0 behavior.
 */
function lowerSinglePipeline(pipeline: PipelineDefinition): GithubTargetGraph {
  const reachableSteps = filterReachableSteps(pipeline);
  const jobIdMap = buildJobIdMap(reachableSteps);

  const triggers = lowerTriggers(pipeline.entries, pipeline.inputs);
  const jobs = lowerStepsWithCalls(reachableSteps, jobIdMap, pipeline.id);

  return assemblePipelineTarget(pipeline, triggers, jobs);
}

/**
 * Assemble a GithubTargetGraph from a pipeline, its triggers, and jobs.
 * Shared by lowerSinglePipeline and lowerMultiPipeline.
 */
function assemblePipelineTarget(
  pipeline: PipelineDefinition,
  triggers: GithubTriggers,
  jobs: readonly GithubJob[],
): GithubTargetGraph {
  return {
    name: pipeline.id,
    on: triggers,
    jobs,
    env: collectEnv(pipeline),
    ...(pipeline.permissions !== undefined ? { permissions: pipeline.permissions } : {}),
    ...(pipeline.defaults !== undefined ? { defaults: lowerDefaults(pipeline.defaults) } : {}),
    ...(pipeline.concurrency !== undefined ? { concurrency: pipeline.concurrency } : {}),
  };
}

/**
 * Lower pipeline defaults to GitHub defaults.run (shell + working-directory only).
 */
function lowerDefaults(defaults: PipelineDefaults): GithubDefaults {
  const run: GithubDefaultsRun = {
    ...(defaults.shell !== undefined ? { shell: defaults.shell } : {}),
    ...(defaults.workdir !== undefined ? { "working-directory": defaults.workdir } : {}),
  };
  return { run };
}

/**
 * Lower a multi-pipeline graph. Each pipeline that has entries OR is referenced
 * by a call step gets its own workflow file.
 */
function lowerMultiPipeline(graph: DefinitionGraph): readonly GithubTargetGraph[] {
  const pipelines = graph.project.pipelines;
  const calledPipelineIds = collectCalledPipelineIds(pipelines);

  const result: GithubTargetGraph[] = [];
  for (const pipeline of pipelines) {
    const target = lowerPipelineInGraph(pipeline, calledPipelineIds.has(pipeline.id));
    if (target !== undefined) result.push(target);
  }
  return result;
}

/**
 * Collect the set of pipeline IDs that are referenced by at least one call step.
 */
function collectCalledPipelineIds(pipelines: readonly PipelineDefinition[]): Set<string> {
  const called = new Set<string>();
  for (const p of pipelines) {
    for (const step of p.steps) {
      if (step.call) {
        called.add(step.call.callee);
      }
    }
  }
  return called;
}

/**
 * Lower a single pipeline within a multi-pipeline graph.
 * Returns undefined if the pipeline is neither a root nor a callee.
 */
function lowerPipelineInGraph(
  pipeline: PipelineDefinition,
  isCalled: boolean,
): GithubTargetGraph | undefined {
  const hasEntries = pipeline.entries.length > 0;
  if (!hasEntries && !isCalled) return undefined;

  // For callees, all steps are reachable (no entries needed).
  // For roots, filter by entry reachability.
  const reachableSteps = hasEntries ? filterReachableSteps(pipeline) : pipeline.steps;
  const jobIdMap = buildJobIdMap(reachableSteps);

  // Triggers: root triggers + workflow_call if called.
  let triggers = lowerTriggers(pipeline.entries, pipeline.inputs);
  if (isCalled) {
    triggers = addWorkflowCall(triggers, pipeline.inputs);
  }

  const jobs = lowerStepsWithCalls(reachableSteps, jobIdMap, pipeline.id);
  return assemblePipelineTarget(pipeline, triggers, jobs);
}

/**
 * Add workflow_call trigger with inputs to a GithubTriggers object.
 */
function addWorkflowCall(
  triggers: GithubTriggers,
  inputs: Readonly<Record<string, Input>>,
): GithubTriggers {
  const inputEntries = Object.entries(inputs);
  if (inputEntries.length === 0) {
    return { ...triggers, workflow_call: null };
  }

  const workflowInputs: Record<string, unknown> = {};
  for (const [name, input] of inputEntries) {
    let type = "string";
    if (input.type === "number") {
      type = "number";
    } else if (input.type === "boolean") {
      type = "boolean";
    }
    const ghInput: Record<string, unknown> = {
      type,
      required: input.required ?? false,
    };
    if (input.default !== undefined) {
      ghInput.default = input.default;
    }
    if (input.description !== undefined) {
      ghInput.description = input.description;
    }
    workflowInputs[name] = ghInput;
  }

  return { ...triggers, workflow_call: { inputs: workflowInputs } };
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
 * Multiple entries of the same kind have their filters merged.
 */
function lowerTriggers(
  entries: readonly EntryDefinition[],
  inputs: Readonly<Record<string, Input>>,
): GithubTriggers {
  const pushBranches = new Set<string>();
  const pushTags = new Set<string>();
  const pushPaths = new Set<string>();
  let pushAll = false;
  const prBranches = new Set<string>();
  const prPaths = new Set<string>();
  let prAll = false;
  let hasManual = false;
  const scheduleEntries: { cron: string; timezone?: string }[] = [];

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        collectFilters(t, pushBranches, pushTags, pushPaths, () => (pushAll = true));
        break;
      case "changeRequest":
        collectFilters(t, prBranches, undefined, prPaths, () => (prAll = true));
        break;
      case "manual":
        hasManual = true;
        break;
      case "schedule":
        scheduleEntries.push({
          cron: t.cron,
          ...(t.timezone ? { timezone: t.timezone } : {}),
        });
        break;
      default:
        throw new GithubTargetError(
          `unsupported trigger kind: ${JSON.stringify((t as Trigger).kind)}`,
          "UNSUPPORTED_TRIGGER",
        );
    }
  }

  return assembleTriggers({
    pushAll,
    pushBranches,
    pushTags,
    pushPaths,
    prAll,
    prBranches,
    prPaths,
    hasManual,
    scheduleEntries,
    inputs,
  });
}

function collectFilters(
  t: Trigger,
  branches: Set<string>,
  tags: Set<string> | undefined,
  paths: Set<string>,
  markAll: () => void,
): void {
  if (t.kind === "schedule") {
    markAll();
    return;
  }
  const filter = t.filter;
  const hasBranches = filter?.branches && filter.branches.length > 0;
  const hasTags = filter?.tags && filter.tags.length > 0;
  const hasPaths = filter?.paths && filter.paths.length > 0;

  // Tag filters are not meaningful on change-request triggers (PRs don't have tags).
  if (hasTags && tags === undefined) {
    throw new GithubTargetError(
      "tag filters are not supported on change-request triggers",
      "UNSUPPORTED_TRIGGER",
    );
  }

  if (hasBranches) addAll(branches, filter!.branches!);
  if (hasTags && tags) addAll(tags, filter!.tags!);
  if (hasPaths) addAll(paths, filter!.paths!);

  // If no filter at all, mark as "fire on all"
  if (!hasBranches && !hasTags && !hasPaths) {
    markAll();
  }
}

/** Add all items from a readonly array to a Set. */
function addAll<T>(set: Set<T>, items: readonly T[]): void {
  for (const item of items) set.add(item);
}

interface TriggerFilters {
  readonly pushAll: boolean;
  readonly pushBranches: Set<string>;
  readonly pushTags: Set<string>;
  readonly pushPaths: Set<string>;
  readonly prAll: boolean;
  readonly prBranches: Set<string>;
  readonly prPaths: Set<string>;
  readonly hasManual: boolean;
  readonly scheduleEntries: readonly { cron: string; timezone?: string }[];
  readonly inputs: Readonly<Record<string, Input>>;
}

function assembleTriggers(f: TriggerFilters): GithubTriggers {
  const triggers: Record<string, unknown> = {};
  const push = assemblePushTrigger(f);
  if (push) triggers.push = push;
  const pr = assemblePullRequestTrigger(f);
  if (pr) triggers.pull_request = pr;
  if (f.hasManual) {
    const loweredInputs = lowerInputs(f.inputs);
    triggers.workflow_dispatch = loweredInputs !== undefined ? { inputs: loweredInputs } : null;
  }
  if (f.scheduleEntries.length > 0) triggers.schedule = f.scheduleEntries;
  return triggers as GithubTriggers;
}

function assemblePushTrigger(f: TriggerFilters): Record<string, string[]> | null {
  if (f.pushAll) return {};
  if (f.pushBranches.size === 0 && f.pushTags.size === 0 && f.pushPaths.size === 0) return null;
  const push: Record<string, string[]> = {};
  if (f.pushBranches.size > 0) push.branches = [...f.pushBranches];
  if (f.pushTags.size > 0) push.tags = [...f.pushTags];
  if (f.pushPaths.size > 0) push.paths = [...f.pushPaths];
  return push;
}

function assemblePullRequestTrigger(f: TriggerFilters): Record<string, string[]> | null {
  if (f.prAll) return {};
  if (f.prBranches.size === 0 && f.prPaths.size === 0) return null;
  const pr: Record<string, string[]> = {};
  if (f.prBranches.size > 0) pr.branches = [...f.prBranches];
  if (f.prPaths.size > 0) pr.paths = [...f.prPaths];
  return pr;
}

/**
 * Lower pipeline inputs to GitHub workflow_dispatch inputs.
 * Returns undefined if no inputs are present.
 * Maps Sverka types to GitHub types: choice→choice, array→unsupported (dropped),
 * others map directly. pattern is dropped (unsupported on GitHub).
 */
function lowerInputs(
  inputs: Readonly<Record<string, Input>>,
): Readonly<Record<string, GithubInput>> | undefined {
  if (Object.keys(inputs).length === 0) return undefined;
  const result: Record<string, GithubInput> = {};
  for (const [name, input] of Object.entries(inputs)) {
    const ghInput: GithubInput = {
      type: input.type === "array" ? "string" : input.type,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.default !== undefined && typeof input.default !== "object"
        ? { default: input.default as string | number | boolean }
        : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
    };
    result[name] = ghInput;
  }
  return result;
}

/**
 * Lower reachable steps to GitHub jobs. One job per step.
 * Call steps become `uses:` jobs (reusable workflow calls).
 * Component steps become `uses:` jobs (composite action calls).
 */
function lowerStepsWithCalls(
  steps: readonly StepDefinition[],
  jobIdMap: Map<string, string>,
  pipelineId: string,
): readonly GithubJob[] {
  return steps.map((step) => {
    if (step.call) {
      return lowerCallStep(step, jobIdMap, pipelineId);
    }
    if (step.component) {
      return lowerComponentStep(step, jobIdMap);
    }
    if (step.childPipeline) {
      return lowerChildPipelineStep(step, jobIdMap);
    }
    if (step.downstream) {
      return lowerDownstreamStep(step, jobIdMap);
    }
    return lowerStep(step, jobIdMap);
  });
}

/**
 * Lower a Reference value to a GitHub expression string.
 * Returns the expression if `value` is a Reference, otherwise `undefined`
 * (meaning the value is a literal the caller should handle itself).
 * Context references are mapped through GITHUB_CONTEXT_MAP so that Sverka
 * namespaces (e.g. `git.sha`) become valid GitHub expressions (e.g.
 * `github.sha`).
 *
 * Secret references are sink-specific:
 * - In `with:` inputs (`forWithInput = true`): `${{ secrets.FIELD }}`.
 *   GitHub Actions does not expand `$FIELD` in `with:` values — it treats it
 *   as a literal string. The `secrets` context is the correct syntax here.
 * - In `run:` commands (`forWithInput = false`, default): `$FIELD`.
 *   The shell expands the env var, and this avoids exposing the secret value
 *   in workflow logs.
 */
function lowerReferenceExpr(
  value: unknown,
  jobIdMap: Map<string, string>,
  forWithInput = false,
): string | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value) {
    const ref = value as Reference;
    if (ref.kind === "step") {
      const producerJobId = jobIdMap.get(ref.step) ?? ref.step;
      return `\${{ needs.${producerJobId}.outputs.${ref.output} }}`;
    }
    if (ref.kind === "context") {
      return translateContextRef(ref.namespace, ref.field, false, forWithInput);
    }
  }
  return undefined;
}

/**
 * Lower a call step to a GitHub reusable workflow call job.
 */
function lowerCallStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  pipelineId: string,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const call = step.call!;
  const callee = call.callee;

  // Build `with:` from bound inputs.
  // Secrets in `with:` inputs must use ${{ secrets.FIELD }} — GitHub Actions
  // does not expand $FIELD in with: values (it treats it as a literal string).
  const withMap: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(call.inputs)) {
    withMap[name] = lowerReferenceExpr(value, jobIdMap, true) ?? value;
  }

  return {
    id: jobId,
    name: jobId,
    runsOn: "ubuntu-latest",
    needs,
    steps: [],
    uses: `./.github/workflows/${callee}.yml`,
    ...(Object.keys(withMap).length > 0 ? { with: withMap } : {}),
    secrets: "inherit",
  };
}

/**
 * Lower a component step to a GitHub composite action call job.
 * F-32: component → uses: org/component@version with `with:` inputs.
 */
function lowerComponentStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const comp = step.component!;

  // Build `with:` from bound inputs.
  // Secrets in `with:` inputs must use ${{ secrets.FIELD }} — GitHub Actions
  // does not expand $FIELD in with: values (it treats it as a literal string).
  const withMap: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(comp.inputs)) {
    withMap[name] = lowerReferenceExpr(value, jobIdMap, true) ?? value;
  }

  // Component references that look like GitHub Actions (org/repo@ref) are
  // emitted as normal jobs with an action step. Reusable workflow references
  // (./.github/workflows/*.yml) remain as `uses:` jobs.
  const isAction = !comp.name.startsWith("./");
  if (isAction) {
    return {
      id: jobId,
      name: jobId,
      runsOn: resolveRunsOn(step),
      needs,
      steps: [
        { name: "Checkout", uses: "actions/checkout@v4" },
        {
          name: `Component ${comp.name}`,
          uses: `${comp.name}@${comp.version}`,
          ...(Object.keys(withMap).length > 0 ? { with: withMap } : {}),
        },
      ],
    };
  }

  return {
    id: jobId,
    name: jobId,
    runsOn: "ubuntu-latest",
    needs,
    steps: [],
    uses: `${comp.name}@${comp.version}`,
    ...(Object.keys(withMap).length > 0 ? { with: withMap } : {}),
  };
}

/**
 * Lower a child pipeline step to a GitHub job.
 * F-33: GitHub does not natively support dynamic child pipelines.
 * We emit a no-op job with a warning comment. The native engine handles
 * the actual dynamic generation.
 */
function lowerChildPipelineStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  return {
    id: jobId,
    name: jobId,
    runsOn: resolveRunsOn(step),
    needs,
    steps: [
      {
        name: "Dynamic child pipeline (not natively supported on GitHub)",
        run: `echo "WARNING: Dynamic child pipelines are not supported by GitHub Actions. Generator: ${step.childPipeline!.generator}, artifact: ${step.childPipeline!.artifact}"`,
      },
    ],
  };
}

/**
 * Lower a downstream step to a GitHub job.
 * F-34: GitHub emulates downstream project triggers via repository_dispatch API.
 */
function lowerDownstreamStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const ds = step.downstream!;
  // Build client_payload from inputs using JSON.stringify for valid JSON.
  const payloadObj: Record<string, string> = {};
  if (ds.inputs) {
    for (const [name, value] of Object.entries(ds.inputs)) {
      payloadObj[name] = lowerReferenceExpr(value, jobIdMap) ?? String(value);
    }
  }
  const payload = JSON.stringify(payloadObj);
  // Pass the payload and optional branch through step env vars, then expand
  // them as quoted shell variables. JSON.stringify does not escape apostrophes
  // for a POSIX shell — embedding the payload in a single-quoted command would
  // break if a runtime value (after GitHub expression expansion) contains a
  // single quote. Env vars are expanded by the runner after GitHub expression
  // evaluation, so the shell receives the value as a single argument.
  const env: Record<string, string> = { CLIENT_PAYLOAD: payload };
  if (ds.branch) {
    env.DOWNSTREAM_BRANCH = ds.branch;
  }
  const refPart = ds.branch ? ` -f ref="$DOWNSTREAM_BRANCH"` : "";
  return {
    id: jobId,
    name: jobId,
    runsOn: resolveRunsOn(step),
    needs,
    steps: [
      {
        name: `Trigger downstream: ${ds.project}`,
        env,
        run: `gh api repos/${ds.project}/dispatches -f event_type=sverka-trigger -f client_payload="$CLIENT_PAYLOAD"${refPart}`,
      },
    ],
  };
}

/**
 * Lower a single Step to a GitHub job.
 */
function lowerStep(step: StepDefinition, jobIdMap: Map<string, string>): GithubJob {
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const rawSteps = lowerOperations(step, jobIdMap);

  // GitHub only supports boolean continue-on-error, not exit-code mapping.
  if (step.continueOnError !== undefined && typeof step.continueOnError !== "boolean") {
    throw new GithubTargetError(
      "GitHub does not support exit-code continueOnError; use a boolean value",
      "UNSUPPORTED_FEATURE",
    );
  }

  // Apply continueOnError to all run steps (not Checkout/uses steps).
  const steps =
    step.continueOnError !== undefined
      ? rawSteps.map((s) =>
          s.run !== undefined
            ? {
                ...s,
                continueOnError:
                  typeof step.continueOnError === "boolean"
                    ? step.continueOnError
                    : true,
              }
            : s,
        )
      : rawSteps;

  const jobId = jobIdMap.get(step.id) ?? step.id;

  // F-48: delay → emulated via sleep step (GitHub has no native delayed execution).
  applyDelay(steps, step);

  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";
  const runsOn = resolveRunsOn(step);
  const container = resolveContainer(step, mode);
  const jobEnv = collectJobEnv(runtime);

  return assembleGithubJob({ jobId, steps, needs, step, runsOn, container, jobEnv, jobIdMap });
}

/**
 * Insert a sleep step to emulate delay (GitHub has no native delayed execution).
 */
function applyDelay(steps: GithubStep[], step: StepDefinition): void {
  if (!step.delay) return;
  const sleepSeconds = parseDurationToSeconds(step.delay);
  // Insert sleep step after checkout (which is always first).
  if (steps.length > 0) {
    steps.splice(1, 0, {
      name: `Delay (${step.delay})`,
      run: `sleep ${sleepSeconds}`,
    });
  }
}

/**
 * Collect scalar output names for the job's `outputs:` mapping.
 * GitHub Actions requires outputs to be declared at the job level for
 * `needs.<job>.outputs.<name>` expressions to work.
 */
function collectJobOutputs(step: StepDefinition): Record<string, string> {
  const jobOutputs: Record<string, string> = {};
  for (const op of step.operations) {
    if (op.kind === "exportOutput") {
      jobOutputs[op.name] = `\${{ steps.output.outputs.${op.name} }}`;
    }
  }
  return jobOutputs;
}

/**
 * Build the job's `steps` array, inserting a cache step after checkout when
 * caching is enabled. Checkout is always the first step.
 */
function resolveJobSteps(steps: GithubStep[], step: StepDefinition): GithubStep[] {
  if (step.cache === undefined) return steps;
  // Cache step goes after checkout (always first) and before other steps.
  return [steps[0]!, lowerCacheStep(step.cache), ...steps.slice(1)];
}

/**
 * Resolve the job-level `if` expression.
 *
 * Rules take precedence over condition when both are present, matching
 * GitHub's behavior where workflow rules override step conditions. Multiple
 * rules are OR'd: GitHub's job-level `if` is a single expression, so we
 * combine all rule `if` conditions with `||`.
 */
function resolveJobIf(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): Record<string, string> {
  if (step.rules !== undefined && step.rules.length > 0) {
    return { if: lowerRulesIf(step.rules) };
  }
  if (step.condition !== undefined) {
    return { if: lowerCondition(step.condition, jobIdMap) };
  }
  return {};
}

/**
 * Resolve job-level permissions and environment for Pages deploys and
 * identity-token requests.
 *
 * GitHub Pages jobs need pages:write and id-token:write permissions.
 */
function resolveJobPermissions(step: StepDefinition): Record<string, unknown> {
  if (step.operations.some((op) => op.kind === "deployPages")) {
    return {
      permissions: { "pages": "write", "id-token": "write" },
      environment: { name: "github-pages" },
    };
  }
  if (step.identity !== undefined) {
    return { permissions: { "id-token": "write" } };
  }
  return {};
}

/**
 * Constituent parts for assembling a GithubJob.
 */
interface GithubJobParts {
  readonly jobId: string;
  readonly steps: GithubStep[];
  readonly needs: readonly string[];
  readonly step: StepDefinition;
  readonly runsOn: GithubRunsOn;
  readonly container: string | undefined;
  readonly jobEnv: Record<string, string>;
  readonly jobIdMap: Map<string, string>;
}

/**
 * Assemble the final GithubJob object from its constituent parts.
 */
function assembleGithubJob(parts: GithubJobParts): GithubJob {
  const { jobId, steps, needs, step, runsOn, container, jobEnv, jobIdMap } = parts;
  const jobOutputs = collectJobOutputs(step);
  const jobIf = resolveJobIf(step, jobIdMap);
  const jobPermissions = resolveJobPermissions(step);

  return {
    id: jobId,
    name: jobId,
    runsOn,
    needs,
    ...(Object.keys(jobOutputs).length > 0 ? { outputs: jobOutputs } : {}),
    steps: resolveJobSteps(steps, step),
    ...(step.timeout !== undefined
      ? { timeoutMinutes: Math.ceil(step.timeout / 60000) }
      : {}),
    ...(Object.keys(jobEnv).length > 0 ? { env: jobEnv } : {}),
    ...(container ? { container } : {}),
    ...(step.matrix !== undefined ? { strategy: lowerStrategy(step.matrix) } : {}),
    ...jobIf,
    ...jobPermissions,
    ...resolveJobServices(step),
    ...resolveJobEnvironment(step),
    ...(step.concurrency !== undefined ? { concurrency: step.concurrency } : {}),
  };
}

/** Resolve job-level services field from step services. */
function resolveJobServices(step: StepDefinition): Partial<GithubJob> {
  if (step.services === undefined || step.services.length === 0) return {};
  return { services: lowerServices(step.services) };
}

/** Resolve job-level environment field from step environment spec. */
function resolveJobEnvironment(step: StepDefinition): Partial<GithubJob> {
  if (step.environment === undefined) return {};
  return {
    environment: {
      name: step.environment.name,
      ...(step.environment.url !== undefined ? { url: step.environment.url } : {}),
    },
  };
}

/**
 * Lower a cache spec to a GitHub cache step.
 * pull-push → actions/cache@v4
 * pull → actions/cache/restore@v4
 * push → actions/cache/save@v4
 */
function lowerCacheStep(cache: CacheSpec): GithubStep {
  const policy = cache.policy ?? "pull-push";
  let action = "actions/cache@v4";
  if (policy === "pull") {
    action = "actions/cache/restore@v4";
  } else if (policy === "push") {
    action = "actions/cache/save@v4";
  }
  const withMap: Record<string, unknown> = {
    path: cache.paths.length === 1 ? cache.paths[0] : cache.paths.join("\n"),
    key: cache.key,
  };
  if (cache.restoreKeys !== undefined && cache.restoreKeys.length > 0) {
    withMap["restore-keys"] = cache.restoreKeys.length === 1 ? cache.restoreKeys[0] : cache.restoreKeys.join("\n");
  }
  return {
    name: "Restore cache",
    uses: action,
    with: withMap,
  };
}

/**
 * Lower service containers to GitHub services map (keyed by name).
 */
function lowerServices(services: readonly ServiceContainer[]): Readonly<Record<string, GithubService>> {
  const result: Record<string, GithubService> = {};
  for (const svc of services) {
    // GitHub Actions does not support `entrypoint` or `command` on services.
    // Translate them to Docker `options` as a best-effort emulation.
    const options: string[] = [];
    if (svc.entrypoint !== undefined) {
      options.push(`--entrypoint=${svc.entrypoint[0] ?? ""}`);
    }
    const service: GithubService = {
      image: svc.image,
      ...(svc.env !== undefined ? { env: { ...svc.env } } : {}),
      ...(svc.ports !== undefined ? { ports: svc.ports.map((p) => `${p}:${p}`) } : {}),
      ...(options.length > 0 ? { options: options.join(" ") } : {}),
    };
    result[svc.name] = service;
  }
  return result;
}

function resolveRunsOn(step: StepDefinition): GithubRunsOn {
  if (step.runner === undefined) {
    return "ubuntu-latest";
  }
  const { labels, group } = step.runner;
  if (group !== undefined) {
    return { group, labels };
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  return labels;
}

/**
 * Parse a duration string (e.g. "5m", "30s", "1h") to seconds.
 * F-48: used for GitHub sleep emulation.
 */
function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)\s*(s|m|h|seconds?|minutes?|hours?)?$/i.exec(duration);
  if (!match) {
    throw new GithubTargetError(
      `invalid delay duration '${duration}'`,
      "LOWER_FAILED",
    );
  }
  const value = Number.parseInt(match[1]!, 10);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit.startsWith("h")) return value * 3600;
  if (unit.startsWith("m")) return value * 60;
  return value;
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
function lowerOperations(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): readonly GithubStep[] {
  const steps: GithubStep[] = [];
  const shortStepId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;

  // Every job needs the repository checked out.
  steps.push({
    name: "Checkout",
    uses: "actions/checkout@v4",
  });

  // beforeScript → run steps before main operations.
  if (step.beforeScript) {
    for (const cmd of step.beforeScript) {
      steps.push({ run: cmd });
    }
  }

  let runLines: string[] = [];
  let runHasOutput = false;

  function flushRun(): void {
    if (runLines.length === 0) return;
    const combined = runLines.join("\n");
    const translated = translateCommand(combined, step.inputs, jobIdMap);
    steps.push({
      // Give the step an id when it contains exportOutput so job-level outputs can reference it.
      ...(runHasOutput ? { id: "output" } : {}),
      run: translated,
      ...(step.runtime.workingDir ? { workingDirectory: step.runtime.workingDir } : {}),
      ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
    });
    runLines = [];
    runHasOutput = false;
  }

  for (const op of step.operations) {
    if (op.kind === "exportOutput") runHasOutput = true;
    lowerOperation(op, shortStepId, steps, runLines, flushRun);
  }

  flushRun();

  // afterScript → run steps after main operations with if: always().
  if (step.afterScript) {
    for (const cmd of step.afterScript) {
      steps.push({ run: cmd, if: "always()" });
    }
  }

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
      // F-49: background shell → append & for async execution.
      runLines.push(op.background ? `${op.command} &` : op.command);
      break;
    case "exportOutput":
      runLines.push(`echo "${op.name}=\${${op.name}}" >> "$GITHUB_OUTPUT"`);
      break;
    case "exportArtifact":
      flushRun();
      steps.push({
        name: `Upload ${op.name}`,
        uses: "actions/upload-artifact@v4",
        with: {
          name: artifactName(shortStepId, op.name),
          path: op.path,
          ...(op.retention !== undefined ? { "retention-days": parseRetentionDays(op.retention) } : {}),
        },
      });
      break;
    case "importArtifact":
      lowerImportArtifact(op, steps, flushRun);
      break;
    case "diagnostic":
      lowerDiagnostic(op, steps, flushRun);
      break;
    case "report":
      flushRun();
      steps.push(lowerReport(op.spec));
      break;
    case "release":
      lowerRelease(op, steps, flushRun);
      break;
    case "deployPages":
      lowerDeployPages(op, steps, flushRun);
      break;
    default:
      throw new GithubTargetError(
        `unsupported operation kind: ${JSON.stringify((op as OperationDefinition).kind)}`,
        "LOWER_FAILED",
      );
  }
}

/**
 * Lower a release operation to a GitHub release step.
 * F-39: uses softprops/action-gh-release@v2.
 */
function lowerRelease(
  op: Extract<OperationDefinition, { kind: "release" }>,
  steps: GithubStep[],
  flushRun: () => void,
): void {
  flushRun();
  const withMap: Record<string, unknown> = {
    tag_name: op.tag,
  };
  if (op.name) withMap.name = op.name;
  if (op.description) withMap.body = op.description;
  if (op.assets && op.assets.length > 0) withMap.files = op.assets.join("\n");
  if (op.draft !== undefined) withMap.draft = op.draft;
  if (op.prerelease !== undefined) withMap.prerelease = op.prerelease;
  steps.push({
    name: `Release ${op.tag}`,
    uses: "softprops/action-gh-release@v2",
    with: withMap,
  });
}

/**
 * Lower a deployPages operation to GitHub Pages deployment steps.
 * F-40: uses actions/upload-pages-artifact + actions/deploy-pages.
 */
function lowerDeployPages(
  op: Extract<OperationDefinition, { kind: "deployPages" }>,
  steps: GithubStep[],
  flushRun: () => void,
): void {
  flushRun();
  // Upload the pages artifact, then deploy.
  steps.push(
    {
      name: "Upload Pages artifact",
      uses: "actions/upload-pages-artifact@v3",
      with: { path: op.path },
    },
    {
      name: "Deploy to GitHub Pages",
      uses: "actions/deploy-pages@v4",
      id: "deployment",
    },
  );
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
    .replace(/%/g, "%25")
    .replace(/\r\n/g, "%0D%0A")
    .replace(/\n/g, "%0A")
    .replace(/\r/g, "%0D");
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
 * Parse a duration string (e.g., "7d", "1h", "30m", "never") into days.
 * Returns undefined for "never" (no retention limit).
 */
function parseRetentionDays(retention: string): number | undefined {
  if (retention === "never") return undefined;
  const match = /^(\d+)([dhm])$/.exec(retention);
  if (match === null) return undefined;
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "d") return value;
  if (unit === "h") return Math.ceil(value / 24);
  if (unit === "m") return Math.ceil(value / (60 * 24));
  return undefined;
}

/**
 * Lower a report spec to a GitHub action step.
 * Maps report types to known GitHub actions.
 */
function lowerReport(spec: ReportSpec): GithubStep {
  switch (spec.type) {
    case "junit":
      return {
        name: `Report ${spec.type}`,
        uses: "dorny/test-reporter@v1",
        with: {
          name: "Tests",
          path: spec.path,
          reporter: "java-junit",
        },
      };
    case "sarif":
    case "sast":
      return {
        name: `Upload ${spec.type}`,
        uses: "github/codeql-action/upload-sarif@v3",
        with: { sarif_file: spec.path },
      };
    default:
      // No standard action — upload as generic artifact
      return {
        name: `Upload ${spec.type} report`,
        uses: "actions/upload-artifact@v4",
        with: { name: `${spec.type}-report`, path: spec.path },
      };
  }
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

// ---------------------------------------------------------------------------
// Matrix lowering (F-15, F-16)
// ---------------------------------------------------------------------------

/**
 * Lower a MatrixSpec to a GitHub strategy object.
 * dimensions → matrix variables, include → include:, exclude → exclude:.
 * failFast → fail-fast, maxParallel → max-parallel.
 */
function lowerStrategy(spec: MatrixSpec): {
  readonly matrix: Record<string, unknown>;
  readonly failFast?: boolean;
  readonly maxParallel?: number;
} {
  const matrix: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(spec.dimensions)) {
    matrix[key] = [...values];
  }
  if (spec.include && spec.include.length > 0) {
    matrix.include = spec.include.map((entry) => ({ ...entry }));
  }
  if (spec.exclude && spec.exclude.length > 0) {
    matrix.exclude = spec.exclude.map((entry) => ({ ...entry }));
  }
  return {
    matrix,
    ...(spec.failFast !== undefined ? { failFast: spec.failFast } : {}),
    ...(spec.maxParallel !== undefined
      ? (() => {
          if (!Number.isInteger(spec.maxParallel) || spec.maxParallel <= 0) {
            throw new GithubTargetError(
              `maxParallel must be a positive integer, got ${spec.maxParallel}`,
              "INVALID_MATRIX",
            );
          }
          return { maxParallel: spec.maxParallel };
        })()
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Context ref translation (F-35)
// ---------------------------------------------------------------------------

const GITHUB_CONTEXT_MAP: Readonly<Record<string, string>> = {
  "git.sha": "github.sha",
  "git.branch": "github.ref_name",
  "git.tag": "github.ref_name",
  "change.id": "github.event.pull_request.number",
  "change.source": "github.event_name",
  "change.target": "github.base_ref",
  "change.draft": "github.event.pull_request.draft",
  "event.type": "github.event_name",
  "run.id": "github.run_id",
  "run.attempt": "github.run_attempt",
};

/**
 * Translate a context ref (namespace.field) to GitHub expression syntax.
 * Secrets are sink-specific:
 * - In `with:` inputs (`forWithInput = true`): `${{ secrets.FIELD }}`.
 *   GitHub Actions does not expand `$FIELD` in `with:` values — it treats it
 *   as a literal string. The `secrets` context is the correct syntax here.
 * - In `run:` commands (`forWithInput = false`): `$FIELD` (env var, avoids
 *   exposing secret values in run logs).
 * In conditions, secrets are not supported by GitHub's if: context and are
 * emitted as env var references instead.
 */
function translateContextRef(namespace: string, field: string, inCondition = false, forWithInput = false): string {
  const key = `${namespace}.${field}`;
  const mapped = GITHUB_CONTEXT_MAP[key];
  if (mapped) return `\${{ ${mapped} }}`;
  // env.X → ${{ env.FIELD }} (GitHub env context)
  if (namespace === "env") {
    return `\${{ env.${field} }}`;
  }
  if (namespace === "matrix") {
    return `\${{ matrix.${field} }}`;
  }
  // inputs.X → ${{ env.FIELD }} (pipeline inputs are lowered to workflow env)
  if (namespace === "inputs") {
    return `\${{ env.${field} }}`;
  }
  // secrets.X in with: inputs → ${{ secrets.FIELD }} (GitHub expands the
  //   secrets context in with: values, but does NOT expand $FIELD there).
  // secrets.X in commands → $FIELD (env var, avoids exposing value in logs)
  // secrets.X in conditions → not supported by GitHub if: context
  if (namespace === "secrets") {
    if (inCondition) {
      // GitHub does not support secrets context in if: expressions.
      // Use env var reference instead (secret is injected as env var).
      return `\${{ env.${field} }}`;
    }
    if (forWithInput) {
      return `\${{ secrets.${field} }}`;
    }
    return `$${field}`;
  }
  // Unknown namespace — fail lowering rather than emit invalid expression
  throw new GithubTargetError(
    `unsupported context namespace '${namespace}' in GitHub lowering`,
    "LOWER_FAILED",
  );
}

/**
 * Translate a step ref to GitHub needs.<jobId>.outputs.<output> syntax.
 * Each Sverka step is lowered to a separate GitHub job, so cross-step
 * references must use the 'needs' context, not 'steps'.
 */
function translateStepRef(ref: StepRef, jobIdMap: Map<string, string>): string {
  const jobId = jobIdMap.get(ref.step) ?? ref.step;
  return `\${{ needs.${jobId}.outputs.${ref.output} }}`;
}

/**
 * Build a lookup map from placeholder key ("namespace.field" or "step.output")
 * to the Reference from the step's inputs array.
 */
function buildInputLookup(inputs: readonly Reference[]): Map<string, Reference> {
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
 * Translate ${...} placeholders in a command string to GitHub expression syntax.
 * Placeholders matching a known input ref are translated; others are left as-is.
 */
function translateCommand(
  command: string,
  inputs: readonly Reference[],
  jobIdMap: Map<string, string>,
): string {
  const lookup = buildInputLookup(inputs);
  return command.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const ref = lookup.get(key);
    if (ref === undefined) {
      // Not a known ref — leave as literal shell variable
      return `\${${key}}`;
    }
    if (ref.kind === "context") {
      return translateContextRef(ref.namespace, ref.field, false);
    }
    return translateStepRef(ref, jobIdMap);
  });
}

/**
 * Lower step rules to a single GitHub `if:` expression.
 * Multiple rules are OR'd with `||`. Rules with `when: never` produce `false`.
 * Rules without an `if` but with `when: always` produce `true`.
 */
function lowerRulesIf(rules: readonly Rule[]): string {
  const parts: string[] = [];
  for (const rule of rules) {
    if (rule.when === "never") {
      parts.push("${{ false }}");
    } else if (rule.if !== undefined) {
      parts.push(rule.if);
    } else if (rule.when === "always") {
      parts.push("${{ true }}");
    }
  }
  if (parts.length === 0) return "${{ true }}";
  if (parts.length === 1) return parts[0]!;
  return parts.map((p) => p.replace(/^\$\{\{|\}\}$/g, "").trim()).join(" || ");
}

/**
 * Lower a step condition to a GitHub if: expression.
 */
function lowerCondition(
  condition: Reference | Expression | StatusCondition,
  jobIdMap: Map<string, string>,
): string {
  if (condition.kind === "status") {
    // GitHub status conditions map to built-in condition functions
    if (condition.status === "always") return "${{ always() }}";
    if (condition.status === "never") return "${{ false }}";
    if (condition.status === "failure") return "${{ failure() }}";
    return "${{ success() }}";
  }
  if (condition.kind === "context") {
    return `\${{ ${stripBraces(translateContextRef(condition.namespace, condition.field, true))} }}`;
  }
  if (condition.kind === "step") {
    return translateStepRef(condition, jobIdMap);
  }
  // Expression — translate each ${...} placeholder
  const lookup = buildInputLookup(condition.refs);
  const translated = condition.template.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    const ref = lookup.get(key);
    if (ref === undefined) return `\${${key}}`;
    if (ref.kind === "context") {
      return stripBraces(translateContextRef(ref.namespace, ref.field, true));
    }
    return stripBraces(translateStepRef(ref, jobIdMap));
  });
  return `\${{ ${translated} }}`;
}

/** Strip the `${{ ... }}` wrapper, returning the inner expression. */
function stripBraces(s: string): string {
  // Match ${{ ... }} and extract inner content, trimming whitespace.
  // Uses anchored pattern without nested quantifiers to avoid ReDoS.
  if (!s.startsWith("${{") || !s.endsWith("}}")) return s;
  return s.slice(3, -2).trim();
}
