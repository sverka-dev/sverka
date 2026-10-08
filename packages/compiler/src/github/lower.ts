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
} from "@sverka/workflow";
import type {
  Trigger,
  MatrixSpec,
  StepRef,
  StatusCondition,
  PipelineDefaults,
  ReportSpec,
  ServiceContainer,
  CacheSpec,
  Rule,
  BootstrapLevel,
} from "@sverka/workflow";
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
  GithubTargetConfig,
} from "./types.js";
import { GithubTargetError } from "./errors.js";
import { buildJobIdMap } from "../job-ids.js";
import { wrapStdoutCaptureLine } from "../stdout-capture.js";
import { compilerVersion } from "../internal/version.js";

/** sverka invocation emitted into generated jobs (version-pinned). */
function sverkaCli(subcommand: string): string {
  return `npx -y sverka@${compilerVersion()} ${subcommand}`;
}

/** Artifact the agent job writes and the apply job consumes (Spec 54). */
const SVERKA_WRITES_FILE = "sverka-writes.json";
const SVERKA_AGENT_RESULT_FILE = "agent-result.json";

/**
 * Lower a Definition Graph to one or more GithubTargetGraphs.
 * - Each pipeline with entries → a root workflow with its triggers.
 * - Each pipeline referenced by a call step → a reusable workflow with
 *   `on: workflow_call` (+ its own triggers if it also has entries).
 * - Call steps become `uses:` jobs.
 * Single-pipeline graphs (no calls) are unchanged (backward compat).
 */
export function lowerGithub(
  graph: DefinitionGraph,
  config?: GithubTargetConfig,
): GithubTargetGraph | readonly GithubTargetGraph[] {
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
      return lowerSinglePipeline(pipeline, config);
    }
  }

  // Multi-pipeline or has special steps → lower all pipelines.
  return lowerMultiPipeline(graph, config);
}

/**
 * The Checkout step shared by every job, with optional `with:` inputs
 * (e.g. `submodules: recursive`) from {@link GithubTargetConfig.checkoutWith}.
 */
function checkoutStep(config?: GithubTargetConfig): GithubStep {
  return {
    name: "Checkout",
    uses: "actions/checkout@v4",
    ...(config?.checkoutWith ? { with: config.checkoutWith } : {}),
  };
}

/**
 * Toolchain/dependency setup steps injected after Checkout in every job
 * that executes user commands (shell and component steps).
 */
function setupSteps(config?: GithubTargetConfig): readonly GithubStep[] {
  return config?.setup ?? [];
}

/**
 * Lower a single pipeline (no calls) — original v0 behavior.
 */
function lowerSinglePipeline(
  pipeline: PipelineDefinition,
  config?: GithubTargetConfig,
): GithubTargetGraph {
  const reachableSteps = filterReachableSteps(pipeline);
  const jobIdMap = buildJobIdMap(reachableSteps);

  const triggers = lowerTriggers(pipeline.entries, pipeline.inputs);
  const gateMap = buildJobGateMap(pipeline, reachableSteps, jobIdMap, false);
  const mentionMap = buildJobMentionMap(pipeline, reachableSteps, jobIdMap);
  const jobs = lowerStepsWithCalls(reachableSteps, {
    jobIdMap,
    pipelineId: pipeline.id,
    pipelineMap: new Map([[pipeline.id, pipeline]]),
    bootstrap: pipeline.bootstrap,
    config,
    gateMap,
    mentionMap,
  });

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
  // Least privilege (S8264): pipeline permissions become per-job grants and
  // the workflow-level default is deny-all. Jobs with explicit permissions
  // (e.g. deploys, safe-outputs) keep theirs.
  const grants = pipeline.permissions;
  const jobsWithPermissions =
    grants === undefined
      ? jobs
      : jobs.map((job): GithubJob => {
          if (job.permissions !== undefined) return job;
          const permissions: Readonly<Record<string, string>> = job.steps.some(
            (s) => s.uses?.startsWith("github/codeql-action/upload-sarif@"),
          )
            ? { ...grants, "security-events": "write" }
            : grants;
          return { ...job, permissions };
        });
  return {
    name: pipeline.id,
    on: triggers,
    jobs: jobsWithPermissions,
    env: collectEnv(pipeline),
    ...(pipeline.permissions !== undefined ? { permissions: {} } : {}),
    ...(pipeline.defaults !== undefined
      ? { defaults: lowerDefaults(pipeline.defaults) }
      : {}),
    ...(pipeline.concurrency !== undefined
      ? { concurrency: pipeline.concurrency }
      : {}),
  };
}

/**
 * Lower pipeline defaults to GitHub defaults.run (shell + working-directory only).
 */
function lowerDefaults(defaults: PipelineDefaults): GithubDefaults {
  const run: GithubDefaultsRun = {
    ...(defaults.shell !== undefined ? { shell: defaults.shell } : {}),
    ...(defaults.workdir !== undefined
      ? { "working-directory": defaults.workdir }
      : {}),
  };
  return { run };
}

/**
 * Lower a multi-pipeline graph. Each pipeline that has entries OR is referenced
 * by a call step gets its own workflow file.
 */
function lowerMultiPipeline(
  graph: DefinitionGraph,
  config?: GithubTargetConfig,
): readonly GithubTargetGraph[] {
  const pipelines = graph.project.pipelines;
  const calledPipelineIds = collectCalledPipelineIds(pipelines);
  const pipelineMap = new Map(pipelines.map((p) => [p.id, p]));

  const result: GithubTargetGraph[] = [];
  for (const pipeline of pipelines) {
    const target = lowerPipelineInGraph(
      pipeline,
      calledPipelineIds.has(pipeline.id),
      pipelineMap,
      config,
    );
    if (target !== undefined) result.push(target);
  }
  return result;
}

/**
 * Collect the set of pipeline IDs that are referenced by at least one call step.
 */
function collectCalledPipelineIds(
  pipelines: readonly PipelineDefinition[],
): Set<string> {
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
  pipelineMap: ReadonlyMap<string, PipelineDefinition>,
  config?: GithubTargetConfig,
): GithubTargetGraph | undefined {
  const hasEntries = pipeline.entries.length > 0;
  if (!hasEntries && !isCalled) return undefined;

  // For callees, all steps are reachable (no entries needed).
  // For roots, filter by entry reachability.
  const reachableSteps = hasEntries
    ? filterReachableSteps(pipeline)
    : pipeline.steps;
  const jobIdMap = buildJobIdMap(reachableSteps);

  // Triggers: root triggers + workflow_call if called.
  let triggers = lowerTriggers(pipeline.entries, pipeline.inputs);
  if (isCalled) {
    triggers = addWorkflowCall(triggers, pipeline);
  }

  const gateMap = hasEntries
    ? buildJobGateMap(pipeline, reachableSteps, jobIdMap, isCalled)
    : new Map<string, string>();
  const mentionMap = hasEntries
    ? buildJobMentionMap(pipeline, reachableSteps, jobIdMap)
    : new Map<string, readonly string[]>();
  const jobs = lowerStepsWithCalls(reachableSteps, {
    jobIdMap,
    pipelineId: pipeline.id,
    pipelineMap,
    bootstrap: pipeline.bootstrap,
    config,
    gateMap,
    mentionMap,
  });
  return assemblePipelineTarget(pipeline, triggers, jobs);
}

/**
 * Every per-step `runtime.secrets` name a pipeline references.
 */
function* runtimeSecretNames(pipeline: PipelineDefinition): Generator<string> {
  for (const step of pipeline.steps) {
    yield* step.runtime.secrets ?? [];
  }
}

function lowerWorkflowCallInput(input: Input): Record<string, unknown> {
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
  return ghInput;
}

/**
 * Add workflow_call trigger with inputs to a GithubTriggers object.
 */
function addWorkflowCall(
  triggers: GithubTriggers,
  pipeline: PipelineDefinition,
): GithubTriggers {
  const inputEntries = Object.entries(pipeline.inputs);
  if (
    inputEntries.length === 0 &&
    pipeline.steps.every((s) => !s.runtime.secrets?.length)
  ) {
    return { ...triggers, workflow_call: null };
  }

  const workflowInputs: Record<string, unknown> = {};
  const workflowSecrets: Record<string, { required?: boolean }> = {};
  for (const [name, input] of inputEntries) {
    // Secret inputs go to workflow_call.secrets — GH requires them there,
    // and a text input would invite pasting a credential unmasked.
    if (input.secret) {
      workflowSecrets[name] = { required: input.required ?? false };
      continue;
    }
    workflowInputs[name] = lowerWorkflowCallInput(input);
  }

  // Steps referencing ${{ secrets.X }} inside the callee need those names
  // declared on workflow_call.secrets too — GitHub rejects a caller-supplied
  // secret the called workflow does not declare.
  for (const name of runtimeSecretNames(pipeline)) {
    workflowSecrets[name] ??= { required: false };
  }

  return {
    ...triggers,
    workflow_call: {
      inputs: workflowInputs,
      ...(Object.keys(workflowSecrets).length > 0
        ? { secrets: workflowSecrets }
        : {}),
    },
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

/** Step IDs reachable from one entry's roots (dependencies followed). */
function reachableStepIds(
  roots: readonly string[],
  pipeline: PipelineDefinition,
): Set<string> {
  const byId = new Map(pipeline.steps.map((s) => [s.id, s]));
  const reachable = new Set<string>();
  const queue: string[] = [];
  enqueueRoots(roots, byId, reachable, queue);
  let head = 0;
  while (head < queue.length) {
    const step = byId.get(queue[head]!);
    head++;
    if (!step) continue;
    enqueueDependencies(step, byId, reachable, queue);
  }
  return reachable;
}

/**
 * Spec 54 — per-job event gating. GitHub fires the whole workflow on any
 * `on:` event, so jobs must be gated to their reaching entries' events —
 * otherwise a `push` would run a `comment`-triggered agent job. A job's
 * `if` is the OR of its reaching entries' conditions; jobs reached by
 * entries covering every event class (with no residual filters) need none.
 */
function buildJobGateMap(
  pipeline: PipelineDefinition,
  reachableSteps: readonly StepDefinition[],
  jobIdMap: ReadonlyMap<string, string>,
  isCalled: boolean,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const entryReachable = new Map(
    pipeline.entries.map((e) => [e.id, reachableStepIds(e.roots, pipeline)]),
  );

  for (const step of reachableSteps) {
    const jobId = jobIdMap.get(step.id)!;
    const reaching = pipeline.entries.filter((e) =>
      entryReachable.get(e.id)?.has(step.id),
    );
    // A gate is redundant only when every entry reaches the job AND no
    // entry carries filters the `on:` union cannot express — any event
    // that fires the workflow then necessarily reaches the job.
    const coversAll =
      reaching.length === pipeline.entries.length &&
      pipeline.entries.every((e) => !triggerHasResidualFilters(e.trigger));
    if (coversAll || reaching.length === 0) continue;
    const clauses = reaching.map((e) => entryIfExpr(e.trigger));
    let gate =
      clauses.length === 1
        ? clauses[0]!
        : clauses.map((c) => `(${c})`).join(" || ");
    // A pipeline invoked through workflow_call must run its jobs even
    // though the event-name guards only match direct-run triggers.
    if (isCalled) {
      gate = `(${gate}) || github.event_name == 'workflow_call'`;
    }
    map.set(jobId, gate);
  }
  return map;
}

/** Filters that cannot be expressed in `on:` and must live in the job `if`. */
function triggerHasResidualFilters(t: Trigger): boolean {
  if (t.kind === "comment") {
    return t.mention !== undefined || t.on !== undefined;
  }
  if (t.kind === "issue") {
    return (t.labels?.length ?? 0) > 0;
  }
  return false;
}

/** One `on:`-level branch/tag pattern as a job-if ref condition. */
function refPatternCond(pattern: string, prefix: string): string | undefined {
  if (!pattern.includes("*")) {
    return `github.ref == '${escapeIfString(prefix + pattern)}'`;
  }
  // `x/**` (and approximately `x/*`) lowers to a prefix test — GitHub
  // expressions have no glob matcher.
  if (pattern.endsWith("/**")) {
    return `startsWith(github.ref, '${escapeIfString(prefix + pattern.slice(0, -3))}')`;
  }
  if (pattern.endsWith("/*")) {
    return `startsWith(github.ref, '${escapeIfString(prefix + pattern.slice(0, -1))}')`;
  }
  return undefined;
}

function refFiltersClauses(t: Extract<Trigger, { kind: "push" }>): string[] {
  const clauses: string[] = [];
  const branches = (t.filter?.branches ?? [])
    .map((b) => refPatternCond(b, "refs/heads/"))
    .filter((c): c is string => c !== undefined);
  const tags = (t.filter?.tags ?? [])
    .map((tag) => refPatternCond(tag, "refs/tags/"))
    .filter((c): c is string => c !== undefined);
  const refs = [...branches, ...tags];
  // `paths` filters cannot be expressed in a job `if` — the workflow-level
  // `on:push.paths` union already narrows the firing events.
  if (refs.length === 1) clauses.push(refs[0]!);
  else if (refs.length > 1) clauses.push(`(${refs.join(" || ")})`);
  return clauses;
}

/**
 * GitHub `jobs.<id>.if` condition (unwrapped expression) for one entry:
 * the event-name guard plus every filter the entry carries. The `on:`
 * union cannot attribute an event to a specific entry, so branch/tag,
 * cron, mention, and label filters are all restated here.
 */
function entryIfExpr(t: Trigger): string {
  switch (t.kind) {
    case "push": {
      const clauses = ["github.event_name == 'push'", ...refFiltersClauses(t)];
      return clauses.join(" && ");
    }
    case "changeRequest":
      return changeRequestIfExpr(t);
    case "manual":
      return "github.event_name == 'workflow_dispatch'";
    case "schedule":
      return `github.event_name == 'schedule' && github.event.schedule == '${escapeIfString(t.cron)}'`;
    case "comment":
      return commentIfExpr(t);
    case "issue":
      return issueIfExpr(t);
  }
}

function changeRequestIfExpr(
  t: Extract<Trigger, { kind: "changeRequest" }>,
): string {
  const clauses = ["github.event_name == 'pull_request'"];
  const branches = t.filter?.branches ?? [];
  if (branches.length === 1) {
    clauses.push(`github.base_ref == '${escapeIfString(branches[0]!)}'`);
  } else if (branches.length > 1) {
    const disjuncts = branches
      .map((b) => `github.base_ref == '${escapeIfString(b)}'`)
      .join(" || ");
    clauses.push(`(${disjuncts})`);
  }
  return clauses.join(" && ");
}

function commentIfExpr(t: Extract<Trigger, { kind: "comment" }>): string {
  const clauses = ["github.event_name == 'issue_comment'"];
  if (t.on === "mergeRequest") {
    clauses.push("github.event.issue.pull_request");
  } else if (t.on === "issue") {
    clauses.push("!github.event.issue.pull_request");
  }
  if (t.mention !== undefined) {
    clauses.push(
      `contains(github.event.comment.body, '${escapeIfString(t.mention)}')`,
    );
  }
  return clauses.join(" && ");
}

function issueIfExpr(t: Extract<Trigger, { kind: "issue" }>): string {
  const clauses = ["github.event_name == 'issues'"];
  if (t.action !== undefined) {
    clauses.push(`github.event.action == '${escapeIfString(t.action)}'`);
  }
  for (const label of t.labels ?? []) {
    clauses.push(
      `contains(github.event.issue.labels.*.name, '${escapeIfString(label)}')`,
    );
  }
  return clauses.join(" && ");
}

/** Escape a literal for embedding inside single-quoted `if` strings. */
function escapeIfString(value: string): string {
  // GitHub expressions escape a single quote by doubling it.
  return value.replaceAll("'", "''"); // nosemgrep — emitted YAML runs on the Actions runner (Node ≥20), not a browser
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
  let hasComment = false;
  let hasIssue = false;
  const issueActions = new Set<string>();
  let issueAllTypes = false;

  for (const entry of entries) {
    const t = entry.trigger;
    switch (t.kind) {
      case "push":
        collectFilters(
          t,
          pushBranches,
          pushTags,
          pushPaths,
          () => (pushAll = true),
        );
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
      case "comment":
        if (t.on === "commit") {
          throw new GithubTargetError(
            "comment trigger with on: 'commit' is not supported on GitHub — commit comments have no Actions event (issue_comment covers issues and pull requests only)",
            "UNSUPPORTED_TRIGGER",
          );
        }
        hasComment = true;
        break;
      case "issue":
        hasIssue = true;
        if (t.action !== undefined) {
          issueActions.add(t.action);
        } else {
          issueAllTypes = true;
        }
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
    hasComment,
    hasIssue,
    issueActions,
    issueAllTypes,
    inputs,
  });
}

function collectFilters(
  t: {
    readonly kind: string;
    readonly filter?: {
      readonly branches?: readonly string[];
      readonly tags?: readonly string[];
      readonly paths?: readonly string[];
    };
  },
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
  readonly hasComment: boolean;
  readonly hasIssue: boolean;
  readonly issueActions: ReadonlySet<string>;
  readonly issueAllTypes: boolean;
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
    triggers.workflow_dispatch =
      loweredInputs !== undefined ? { inputs: loweredInputs } : null;
  }
  if (f.scheduleEntries.length > 0) triggers.schedule = f.scheduleEntries;
  // Spec 54 — comment → issue_comment (created only: mention replies must
  // not re-fire on edits); mention/on filters live in job-level `if`.
  if (f.hasComment) triggers.issue_comment = { types: ["created"] };
  if (f.hasIssue) {
    triggers.issues =
      !f.issueAllTypes && f.issueActions.size > 0
        ? { types: [...f.issueActions] }
        : null;
  }
  return triggers as GithubTriggers;
}

function assemblePushTrigger(
  f: TriggerFilters,
): Record<string, string[]> | null {
  if (f.pushAll) return {};
  if (
    f.pushBranches.size === 0 &&
    f.pushTags.size === 0 &&
    f.pushPaths.size === 0
  )
    return null;
  const push: Record<string, string[]> = {};
  if (f.pushBranches.size > 0) push.branches = [...f.pushBranches];
  if (f.pushTags.size > 0) push.tags = [...f.pushTags];
  if (f.pushPaths.size > 0) push.paths = [...f.pushPaths];
  return push;
}

function assemblePullRequestTrigger(
  f: TriggerFilters,
): Record<string, string[]> | null {
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
 * Secret inputs are skipped — a dispatch text field would invite pasting a
 * credential unmasked; they resolve via `${{ secrets.<name> }}` instead.
 */
function lowerDispatchInput(input: Input): GithubInput {
  return {
    type: input.type === "array" ? "string" : input.type,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.required !== undefined ? { required: input.required } : {}),
    ...(input.default !== undefined && typeof input.default !== "object"
      ? { default: input.default as string | number | boolean }
      : {}),
    ...(input.options !== undefined ? { options: input.options } : {}),
  };
}

function lowerInputs(
  inputs: Readonly<Record<string, Input>>,
): Readonly<Record<string, GithubInput>> | undefined {
  if (Object.keys(inputs).length === 0) return undefined;
  const result: Record<string, GithubInput> = {};
  for (const [name, input] of Object.entries(inputs)) {
    if (input.secret) continue;
    result[name] = lowerDispatchInput(input);
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Lower reachable steps to GitHub jobs. One job per step.
 * Call steps become `uses:` jobs (reusable workflow calls).
 * Component steps become `uses:` jobs (composite action calls).
 */
/**
 * Spec 54 — map each job to every distinct comment-trigger mention
 * carried by entries reaching it (annotation + SVERKA_MENTION re-check
 * inside the sandboxed agent job). Multiple comment entries may reach
 * one job with different mentions; all of them are emitted so the
 * in-job re-check accepts whichever entry fired.
 */
function buildJobMentionMap(
  pipeline: PipelineDefinition,
  reachableSteps: readonly StepDefinition[],
  jobIdMap: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  const entryReachable = new Map(
    pipeline.entries.map((e) => [e.id, reachableStepIds(e.roots, pipeline)]),
  );
  for (const step of reachableSteps) {
    const jobId = jobIdMap.get(step.id)!;
    for (const entry of pipeline.entries) {
      const t = entry.trigger;
      if (t.kind !== "comment" || t.mention === undefined) continue;
      if (entryReachable.get(entry.id)?.has(step.id)) {
        const list = map.get(jobId) ?? [];
        if (!list.includes(t.mention)) list.push(t.mention);
        map.set(jobId, list);
      }
    }
  }
  return map;
}

interface StepsLoweringContext {
  jobIdMap: Map<string, string>;
  pipelineId: string;
  pipelineMap: ReadonlyMap<string, PipelineDefinition>;
  bootstrap: BootstrapLevel | undefined;
  config: GithubTargetConfig | undefined;
  gateMap: ReadonlyMap<string, string>;
  mentionMap: ReadonlyMap<string, readonly string[]>;
}

function lowerStepsWithCalls(
  steps: readonly StepDefinition[],
  ctx: StepsLoweringContext,
): readonly GithubJob[] {
  const usedJobIds = new Set<string>(ctx.jobIdMap.values());
  return steps.flatMap((step) => {
    const jobId = ctx.jobIdMap.get(step.id) ?? step.id;
    const gate = ctx.gateMap.get(jobId);
    let job: GithubJob;
    if (step.call) {
      job = lowerCallStep(
        step,
        ctx.jobIdMap,
        ctx.pipelineId,
        ctx.pipelineMap,
        gate,
      );
    } else if (step.component) {
      job = lowerComponentStep(
        step,
        ctx.jobIdMap,
        ctx.bootstrap,
        ctx.config,
        gate,
      );
    } else if (step.childPipeline) {
      job = lowerChildPipelineStep(step, ctx.jobIdMap, gate);
    } else if (step.downstream) {
      job = lowerDownstreamStep(step, ctx.jobIdMap, gate);
    } else {
      job = lowerStep(
        step,
        ctx.jobIdMap,
        ctx.bootstrap,
        ctx.config,
        gate,
        ctx.mentionMap.get(jobId),
      );
    }
    const applyJob = buildApplyJob(step, job, gate, usedJobIds);
    if (applyJob !== undefined) usedJobIds.add(applyJob.id);
    return applyJob !== undefined ? [job, applyJob] : [job];
  });
}

/**
 * Spec 54 — safe-outputs apply job (GitHub): `sverka apply` against the
 * agent job's `sverka-writes.json` artifact, under a job-scoped token
 * whose permissions derive from the declared write kinds. The agent job
 * itself stays read-only — only this job can write.
 */
function buildApplyJob(
  step: StepDefinition,
  agentJob: GithubJob,
  entryGate: string | undefined,
  usedJobIds: ReadonlySet<string>,
): GithubJob | undefined {
  const writes = step.permissions?.write;
  if (writes === undefined || writes.length === 0) return undefined;
  if (!step.operations.some((op) => op.kind === "agent")) return undefined;
  const jobId = agentJob.id;
  // The generated `<step>_apply` id can collide with a user step id —
  // suffix it until unique so one job never overwrites the other.
  let applyId = `${jobId}_apply`;
  let collision = 1;
  while (usedJobIds.has(applyId)) {
    applyId = `${jobId}_apply${collision}`;
    collision++;
  }
  const permissions = writePermissions(writes);
  return {
    id: applyId,
    name: applyId,
    runsOn: "ubuntu-latest",
    needs: [jobId],
    ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    steps: [
      {
        name: "Download agent writes",
        uses: "actions/download-artifact@v8",
        with: { name: `${jobId}-agent-writes`, path: "." },
      },
      {
        name: "Apply writes",
        env: {
          GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
          SVERKA_WRITE_DECLARATIONS: JSON.stringify(writes),
          SVERKA_ISSUE_IID:
            "${{ github.event.issue.number || github.event.pull_request.number }}",
        },
        run: sverkaCli("apply --provider github"),
      },
    ],
  };
}

/** Map write declarations to a GitHub job permissions block. */
function writePermissions(
  writes: readonly { readonly kind: string }[],
): Readonly<Record<string, string>> | undefined {
  const perms: Record<string, string> = {};
  for (const decl of writes) {
    const mapped = WRITE_KIND_TO_GHA_PERMISSION[decl.kind];
    if (mapped === undefined) continue;
    const [scope, level] = mapped.split(": ");
    perms[scope!] = level!;
  }
  return Object.keys(perms).length > 0 ? perms : undefined;
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
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value
  ) {
    const ref = value as Reference;
    if (ref.kind === "step") {
      const producerJobId = jobIdMap.get(ref.step) ?? ref.step;
      return `\${{ needs.${producerJobId}.outputs.${ref.output} }}`;
    }
    if (ref.kind === "context") {
      return translateContextRef(ref.namespace, ref.field, forWithInput);
    }
  }
  return undefined;
}

/**
 * Lower one secret callee-input binding to a `secrets:` map value.
 * GH allows only github/needs/secrets contexts in that map; anything else
 * (inputs/env/matrix/…) is invalid — fail with a clear error. Literal
 * bindings fall back to the same-named caller secret rather than embedding
 * a credential into the workflow file.
 */
function lowerSecretBinding(
  name: string,
  value: unknown,
  callee: string,
  jobIdMap: Map<string, string>,
): string {
  const lowered = lowerReferenceExpr(value, jobIdMap, true);
  if (
    typeof lowered === "string" &&
    !/^\$\{\{ (secrets|github|needs)\./.test(lowered)
  ) {
    throw new GithubTargetError(
      `secret input '${name}' of callee '${callee}' is bound to '${lowered}' — only secrets.*, github.*, and needs.* contexts are allowed in a call job's secrets map`,
      "LOWER_FAILED",
    );
  }
  return typeof lowered === "string" ? lowered : `\${{ secrets.${name} }}`;
}

/**
 * With an explicit secrets map there is no `inherit`, so pass through
 * every other secret the callee can reference — its declared secret
 * inputs and per-step runtime.secrets resolve by name.
 */
function passThroughCalleeSecrets(
  calleeDef: PipelineDefinition | undefined,
  secretMap: Record<string, string>,
): void {
  if (!calleeDef) return;
  for (const [name, input] of Object.entries(calleeDef.inputs)) {
    if (input.secret) secretMap[name] ??= `\${{ secrets.${name} }}`;
  }
  for (const name of runtimeSecretNames(calleeDef)) {
    secretMap[name] ??= `\${{ secrets.${name} }}`;
  }
}

/**
 * Lower a call step to a GitHub reusable workflow call job.
 */
function lowerCallStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  pipelineId: string,
  pipelineMap: ReadonlyMap<string, PipelineDefinition>,
  entryGate: string | undefined,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const call = step.call!;
  const callee = call.callee;
  const calleeDef = pipelineMap.get(callee);

  // Build `with:` from bound inputs.
  // Secrets in `with:` inputs must use ${{ secrets.FIELD }} — GitHub Actions
  // does not expand $FIELD in with: values (it treats it as a literal string).
  const withMap: Record<string, unknown> = {};
  const secretMap: Record<string, string> = {};
  for (const [name, value] of Object.entries(call.inputs)) {
    // Secret callee inputs are declared under workflow_call.secrets, so
    // they must be passed via the job's `secrets:` map — a `with:` entry
    // would be an undeclared input and could leak a literal credential.
    if (calleeDef?.inputs?.[name]?.secret) {
      secretMap[name] = lowerSecretBinding(name, value, callee, jobIdMap);
      continue;
    }
    withMap[name] = lowerReferenceExpr(value, jobIdMap, true) ?? value;
  }
  if (Object.keys(secretMap).length > 0) {
    passThroughCalleeSecrets(calleeDef, secretMap);
  }

  return {
    id: jobId,
    name: jobId,
    runsOn: "ubuntu-latest",
    needs,
    steps: [],
    uses: `./.github/workflows/${callee}.yml`,
    ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
    ...(Object.keys(withMap).length > 0 ? { with: withMap } : {}),
    secrets: Object.keys(secretMap).length > 0 ? secretMap : "inherit",
  };
}

/**
 * Lower a component step to a GitHub composite action call job.
 * F-32: component → uses: org/component@version with `with:` inputs.
 */
function lowerComponentStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  bootstrap: BootstrapLevel | undefined,
  config: GithubTargetConfig | undefined,
  entryGate: string | undefined,
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
      ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
      steps: [
        ...(bootstrap !== "none" ? [checkoutStep(config)] : []),
        ...(bootstrap === undefined || bootstrap === "toolchain"
          ? setupSteps(config)
          : []),
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
    ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
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
  entryGate: string | undefined,
): GithubJob {
  const jobId = jobIdMap.get(step.id) ?? step.id;
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  return {
    id: jobId,
    name: jobId,
    runsOn: resolveRunsOn(step),
    needs,
    ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
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
  entryGate: string | undefined,
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
    ...(entryGate !== undefined ? { if: `\${{ ${entryGate} }}` } : {}),
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
function lowerStep(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  bootstrap: BootstrapLevel | undefined,
  config: GithubTargetConfig | undefined,
  entryGate: string | undefined,
  mentions: readonly string[] | undefined,
): GithubJob {
  const needs = lowerDependencies(step.dependencies, jobIdMap);
  const rawSteps = lowerOperations(step, jobIdMap, bootstrap, config, mentions);

  // GitHub only supports boolean continue-on-error, not exit-code mapping.
  if (
    step.continueOnError !== undefined &&
    typeof step.continueOnError !== "boolean"
  ) {
    throw new GithubTargetError(
      "GitHub does not support exit-code continueOnError; use a boolean value",
      "UNSUPPORTED_FEATURE",
    );
  }

  const steps = applyContinueOnError(rawSteps, step, config);

  const jobId = jobIdMap.get(step.id) ?? step.id;

  const runtime = step.runtime;
  const mode = runtime.mode ?? "host";
  const runsOn = resolveRunsOn(step);
  const container = resolveContainer(step, mode);

  return assembleGithubJob({
    jobId,
    steps,
    needs,
    step,
    runsOn,
    container,
    jobIdMap,
    entryGate,
  });
}

/**
 * Apply continueOnError to the step's own run commands. Injected setup
 * stays fail-fast — a failed dependency install must not be ignored.
 */
function applyContinueOnError(
  rawSteps: readonly GithubStep[],
  step: StepDefinition,
  config?: GithubTargetConfig,
): GithubStep[] {
  const infraSteps = new Set<GithubStep>(setupSteps(config));
  return rawSteps.map((s) =>
    step.continueOnError !== undefined &&
    s.run !== undefined &&
    !infraSteps.has(s)
      ? {
          ...s,
          continueOnError:
            typeof step.continueOnError === "boolean"
              ? step.continueOnError
              : true,
        }
      : s,
  );
}

/**
 * Insert a sleep step to emulate delay (GitHub has no native delayed execution).
 * Called after checkout + setup steps are pushed, so the delay precedes the
 * step's own work but does not postpone toolchain setup.
 */
function applyDelay(steps: GithubStep[], step: StepDefinition): void {
  if (!step.delay) return;
  const sleepSeconds = parseDurationToSeconds(step.delay);
  steps.push({
    name: `Delay (${step.delay})`,
    run: `sleep ${sleepSeconds}`,
  });
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
function resolveJobSteps(
  steps: GithubStep[],
  step: StepDefinition,
): GithubStep[] {
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
  entryGate: string | undefined,
  jobIdMap: Map<string, string>,
): Record<string, string> {
  let base: string | undefined;
  if (step.rules !== undefined && step.rules.length > 0) {
    base = lowerRulesIf(step.rules);
  } else if (step.condition !== undefined) {
    base = lowerCondition(
      step.condition,
      jobIdMap,
      step.runtime?.env,
      step.runtime?.secrets,
    );
  }
  if (entryGate === undefined) {
    return base !== undefined ? { if: base } : {};
  }
  const inner = base !== undefined ? stripBraces(base) : undefined;
  const combined =
    inner !== undefined ? `(${entryGate}) && (${inner})` : entryGate;
  return { if: `\${{ ${combined} }}` };
}

/**
 * Resolve job-level permissions and environment for Pages deploys and
 * identity-token requests.
 *
 * GitHub Pages jobs need pages:write and id-token:write permissions.
 * Safe-outputs (Spec 25): steps with permissions.write get a scoped
 * permissions block from write kinds. Steps without writes get
 * permissions: {} (read-only). deployPages/identity take precedence.
 */
const WRITE_KIND_TO_GHA_PERMISSION: Readonly<Record<string, string>> = {
  "pull-request": "pull-requests: write",
  comment: "issues: write",
  deploy: "deployments: write",
  push: "contents: write",
  "id-token": "id-token: write",
  pages: "pages: write",
};

function resolveJobPermissions(step: StepDefinition): Record<string, unknown> {
  if (step.operations.some((op) => op.kind === "deployPages")) {
    return {
      permissions: { pages: "write", "id-token": "write" },
      environment: { name: "github-pages" },
    };
  }
  if (step.identity !== undefined) {
    return { permissions: { "id-token": "write" } };
  }
  // Spec 54: agent jobs are always read-only — writes go through the
  // separate `<step>_apply` job with scoped permissions. Read scopes cover
  // the untrusted prompt's context (MR/issue bodies, comments, code).
  if (step.operations.some((op) => op.kind === "agent")) {
    return {
      permissions: {
        contents: "read",
        issues: "read",
        "pull-requests": "read",
      },
    };
  }
  // Safe-outputs: derive permissions from write declarations.
  // Only emit a permissions block when step.permissions is explicitly set.
  if (step.permissions !== undefined) {
    const writes = step.permissions.write;
    if (writes && writes.length > 0) {
      const perms: Record<string, string> = {};
      for (const decl of writes) {
        const mapped = WRITE_KIND_TO_GHA_PERMISSION[decl.kind];
        if (mapped !== undefined) {
          const [scope, level] = mapped.split(": ");
          perms[scope!] = level!;
        } else {
          // Unknown kind → safe default
          perms["contents"] = "read";
        }
      }
      return { permissions: perms };
    }
    // permissions set but no writes → explicit read-only
    return { permissions: {} };
  }
  // No permissions set → backward compatible (no permissions key)
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
  readonly jobIdMap: Map<string, string>;
  /** Spec 54 — entry-event gate (unwrapped expr) AND'd with the job `if`. */
  readonly entryGate?: string | undefined;
}

/**
 * Assemble the final GithubJob object from its constituent parts.
 */
function assembleGithubJob(parts: GithubJobParts): GithubJob {
  const { jobId, steps, needs, step, runsOn, container, jobIdMap } = parts;
  const jobOutputs = collectJobOutputs(step);
  const jobIf = resolveJobIf(step, parts.entryGate, jobIdMap);
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
    ...(container ? { container } : {}),
    ...(step.matrix !== undefined
      ? { strategy: lowerStrategy(step.matrix) }
      : {}),
    ...jobIf,
    ...jobPermissions,
    ...resolveJobServices(step),
    ...resolveJobEnvironment(step),
    ...(step.concurrency !== undefined
      ? { concurrency: step.concurrency }
      : {}),
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
      ...(step.environment.url !== undefined
        ? { url: step.environment.url }
        : {}),
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
    withMap["restore-keys"] =
      cache.restoreKeys.length === 1
        ? cache.restoreKeys[0]
        : cache.restoreKeys.join("\n");
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
function lowerServices(
  services: readonly ServiceContainer[],
): Readonly<Record<string, GithubService>> {
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
      ...(svc.ports !== undefined
        ? { ports: svc.ports.map((p) => `${p}:${p}`) }
        : {}),
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

/**
 * Collect the environment a step's shell commands run under:
 * `runtime.env` literals plus `runtime.secrets` resolved via
 * `${{ secrets.<name> }}`.
 */
function collectStepEnv(
  runtime: StepDefinition["runtime"],
): Record<string, string> {
  const stepEnv: Record<string, string> = {};
  if (runtime.env) {
    Object.assign(stepEnv, runtime.env);
  }
  if (runtime.secrets) {
    for (const secret of runtime.secrets) {
      stepEnv[secret] = `\${{ secrets.${secret} }}`;
    }
  }
  return stepEnv;
}

/**
 * Attach the step's env to one of its own `run:` steps — beforeScript,
 * shell ops, and afterScript carry the step's commands and get the env;
 * injected setup/plumbing steps (checkout, toolchain, delay, allowlist
 * echo, artifact upload) never do.
 */
function withStepEnv(
  step: GithubStep,
  stepEnv: Record<string, string>,
): GithubStep {
  if (Object.keys(stepEnv).length === 0) return step;
  return { ...step, env: { ...step.env, ...stepEnv } };
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
  bootstrap: BootstrapLevel | undefined,
  config: GithubTargetConfig | undefined,
  mentions: readonly string[] | undefined,
): readonly GithubStep[] {
  const steps: GithubStep[] = [];
  const shortStepId = step.id.includes("/")
    ? step.id.split("/").pop()!
    : step.id;
  const stepEnv = collectStepEnv(step.runtime);

  // Spec 54: at most one agent operation per step — the emulated job sets
  // one SVERKA_AGENT_* env block.
  if (step.operations.filter((op) => op.kind === "agent").length > 1) {
    throw new GithubTargetError(
      `step '${step.id}' has multiple agent operations — the github target supports at most one per step`,
      "LOWER_FAILED",
    );
  }

  // Every job needs the repository checked out, then toolchain/dependency
  // setup runs before everything else — unless the pipeline opts out via
  // bootstrap ("checkout" skips setup; "none" skips both).
  if (bootstrap !== "none") {
    steps.push(checkoutStep(config));
  }
  if (bootstrap === undefined || bootstrap === "toolchain") {
    steps.push(...setupSteps(config));
  }

  // F-48: delay → sleep after toolchain setup, before the step's own work.
  applyDelay(steps, step);

  // Spec 26: network allowlist annotation (GHA has no native per-job egress control).
  if (step.runtime.network && step.runtime.network.allowed.length > 0) {
    steps.push({
      name: "Sverka network allowlist",
      run: `echo "# sverka:network-allowlist: ${step.runtime.network.allowed.join(",")}"`,
    });
  }

  // beforeScript → run steps before main operations.
  if (step.beforeScript) {
    for (const cmd of step.beforeScript) {
      steps.push(withStepEnv({ run: cmd }, stepEnv));
    }
  }

  let runLines: string[] = [];
  let runHasOutput = false;
  // exportStdout ops bind to the most recent shell op's captured stdout.
  // stdoutTargetIndex marks that op's line inside runLines; stdoutNames are
  // the artifact names declared against it; stdoutUploadNames collects every
  // name whose upload-artifact step follows the flushed run step.
  let stdoutTargetIndex: number | undefined;
  let stdoutNames: string[] = [];
  let stdoutUploadNames: string[] = [];

  function sealStdoutCapture(): void {
    if (stdoutTargetIndex === undefined || stdoutNames.length === 0) return;
    runLines[stdoutTargetIndex] = wrapStdoutCaptureLine(
      runLines[stdoutTargetIndex]!,
      stdoutNames,
    );
    stdoutUploadNames.push(...stdoutNames);
    stdoutNames = [];
  }

  function flushRun(): void {
    sealStdoutCapture();
    if (runLines.length === 0) return;
    const combined = runLines.join("\n");
    const translated = translateCommand(combined, step.inputs, jobIdMap);
    steps.push(
      withStepEnv(
        {
          // Give the step an id when it contains exportOutput so job-level outputs can reference it.
          ...(runHasOutput ? { id: "output" } : {}),
          run: translated,
          ...(step.runtime.workingDir
            ? { workingDirectory: step.runtime.workingDir }
            : {}),
          ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
        },
        stepEnv,
      ),
    );
    for (const name of stdoutUploadNames) {
      // The runtime persists stdout artifacts even when the shell command
      // fails, so the upload must run unconditionally. The capture writes
      // the file inside the step's working directory when one is set.
      steps.push({
        name: `Upload ${name}`,
        if: "always()",
        uses: "actions/upload-artifact@v7",
        with: {
          name: artifactName(shortStepId, name),
          path: step.runtime.workingDir
            ? `${step.runtime.workingDir}/${name}`
            : name,
        },
      });
    }
    runLines = [];
    runHasOutput = false;
    stdoutTargetIndex = undefined;
    stdoutUploadNames = [];
  }

  for (const op of step.operations) {
    if (op.kind === "exportOutput") runHasOutput = true;
    switch (op.kind) {
      case "shell":
        // Seal any pending stdout capture before the new command becomes the
        // most recent shell op.
        sealStdoutCapture();
        // F-49: background shell → append & for async execution.
        runLines.push(op.background ? `${op.command} &` : op.command);
        stdoutTargetIndex = runLines.length - 1;
        break;
      case "agent": {
        // Spec 54 — agent op is a standalone run step: env carries the
        // engine contract; artifacts (result + writes) upload afterwards.
        flushRun();
        steps.push(
          ...lowerAgentOp(
            op,
            step,
            jobIdMap,
            jobIdMap.get(step.id) ?? step.id,
            mentions,
          ),
        );
        break;
      }
      case "exportStdout":
        if (stdoutTargetIndex === undefined) {
          throw new GithubTargetError(
            `step '${step.id}' declares stdout artifact '${op.name}' but no shell output was captured`,
            "LOWER_FAILED",
          );
        }
        if (
          step.runtime.shell !== undefined &&
          !isPosixShell(step.runtime.shell)
        ) {
          throw new GithubTargetError(
            `step '${step.id}' declares stdout artifact '${op.name}' but shell '${step.runtime.shell}' is not POSIX-compatible`,
            "LOWER_FAILED",
          );
        }
        stdoutNames.push(op.name);
        break;
      default:
        lowerOperation(op, shortStepId, steps, runLines, flushRun);
    }
  }

  flushRun();

  // afterScript → run steps after main operations with if: always().
  if (step.afterScript) {
    for (const cmd of step.afterScript) {
      steps.push(withStepEnv({ run: cmd, if: "always()" }, stepEnv));
    }
  }

  return steps;
}

/** Shells whose run scripts understand POSIX syntax (brace groups, `||`, `[ ]`). */
const POSIX_SHELLS = new Set(["sh", "bash", "dash", "ash", "zsh", "ksh"]);

function isPosixShell(shell: string): boolean {
  const space = shell.indexOf(" ");
  return POSIX_SHELLS.has(space === -1 ? shell : shell.slice(0, space));
}

function lowerOperation(
  op: OperationDefinition,
  shortStepId: string,
  steps: GithubStep[],
  runLines: string[],
  flushRun: () => void,
): void {
  switch (op.kind) {
    case "exportOutput":
      runLines.push(`echo "${op.name}=\${${op.name}}" >> "$GITHUB_OUTPUT"`);
      break;
    case "exportArtifact":
      flushRun();
      steps.push({
        name: `Upload ${op.name}`,
        uses: "actions/upload-artifact@v7",
        with: {
          name: artifactName(shortStepId, op.name),
          path: op.path,
          ...(op.retention !== undefined
            ? { "retention-days": parseRetentionDays(op.retention) }
            : {}),
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

function lowerImportArtifact(
  op: Extract<OperationDefinition, { kind: "importArtifact" }>,
  steps: GithubStep[],
  flushRun: () => void,
): void {
  flushRun();
  const fromShort = op.from.includes("/") ? op.from.split("/").pop()! : op.from;
  steps.push({
    name: `Download ${op.output}`,
    uses: "actions/download-artifact@v8",
    with: { name: artifactName(fromShort, op.output), path: op.output },
  });
}

function lowerDiagnostic(
  op: Extract<OperationDefinition, { kind: "diagnostic" }>,
  steps: GithubStep[],
  flushRun: () => void,
): void {
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
 * Spec 54 — emulated agent job steps: `sverka agent` resolves the driver
 * from SVERKA_AGENT_* env vars (keys injected via secrets), runs the
 * agent, and writes `agent-result.json` + `sverka-writes.json`, uploaded
 * unconditionally so a failed agent still leaves a debuggable result.
 * The prompt template is translated to GitHub expressions the same way
 * shell commands are (${{ github.event.* }} etc.).
 */
function lowerAgentOp(
  op: Extract<OperationDefinition, { kind: "agent" }>,
  step: StepDefinition,
  jobIdMap: Map<string, string>,
  jobId: string,
  mentions: readonly string[] | undefined,
): GithubStep[] {
  const env: Record<string, string> = {
    SVERKA_AGENT_ENGINE: op.engine,
    SVERKA_AGENT_PROMPT: translateCommand(op.prompt, step.inputs, jobIdMap),
    SVERKA_AGENT_ANTHROPIC_KEY: "${{ secrets.SVERKA_AGENT_ANTHROPIC_KEY }}",
    SVERKA_AGENT_OPENAI_KEY: "${{ secrets.SVERKA_AGENT_OPENAI_KEY }}",
    // No GITHUB_TOKEN here: the agent job processes untrusted comment text
    // and stays read-only — the write-capable token lives only in the
    // `<step>_apply` job.
  };
  if (op.model !== undefined) env.SVERKA_AGENT_MODEL = op.model;
  if (op.maxTokens !== undefined) {
    env.SVERKA_AGENT_MAX_TOKENS = String(op.maxTokens);
  }
  if (mentions !== undefined && mentions.length > 0) {
    // Several comment entries with different mentions can reach this job;
    // the env var carries all of them so the in-job re-check accepts any.
    env.SVERKA_MENTION =
      mentions.length === 1 ? mentions[0]! : JSON.stringify(mentions);
  }
  const run = step.runtime.workingDir
    ? sverkaCli('agent --output-dir "$GITHUB_WORKSPACE"')
    : sverkaCli("agent");
  const workingDir = step.runtime.workingDir;
  return [
    {
      name: `Agent (${op.engine})`,
      env,
      run,
      ...(workingDir !== undefined ? { workingDirectory: workingDir } : {}),
    },
    {
      name: "Upload agent artifacts",
      if: "always()",
      uses: "actions/upload-artifact@v7",
      with: {
        name: `${jobId}-agent-writes`,
        path: `${SVERKA_AGENT_RESULT_FILE}\n${SVERKA_WRITES_FILE}`,
      },
    },
  ];
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
        uses: "actions/upload-artifact@v7",
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
  // Spec 54 — issue_comment/issues event payload contexts.
  "event.comment.body": "github.event.comment.body",
  "event.comment.author": "github.event.comment.user.login",
  "event.issue.iid": "github.event.issue.number",
  "event.issue.title": "github.event.issue.title",
  "event.mr.iid": "github.event.issue.number",
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
 */
function translateContextRef(
  namespace: string,
  field: string,
  forWithInput = false,
): string {
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
  if (namespace === "secrets") {
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
 * Translate a context ref inside a job-level `if:` condition, returning the
 * inner expression (unwrapped, for embedding into a larger ${{ }}).
 *
 * GitHub evaluates `jobs.<id>.if` before the matrix and outside any env —
 * its context allowlist is github/needs/vars/inputs only. inputs.X uses the
 * real inputs context; env.X inlines the literal declared in the step's
 * runtime.env (static values only — a ${...} expression in the value would
 * be quoted, not evaluated). secrets.X and matrix.X have no valid
 * job-level expression and fail lowering rather than emitting a
 * silently-unresolvable gate.
 */
function translateConditionContextRef(
  namespace: string,
  field: string,
  jobEnv: Readonly<Record<string, string>> | undefined,
  jobSecrets: readonly string[] | undefined,
): string {
  // GitHub's inputs context IS allowed in jobs.<id>.if — pipeline inputs
  // lower to workflow inputs for dispatch/call entries, so this resolves.
  if (namespace === "inputs") {
    return `inputs.${field}`;
  }
  if (namespace === "env") {
    return translateEnvConditionRef(field, jobEnv, jobSecrets);
  }
  if (namespace === "secrets" || namespace === "matrix") {
    const hint =
      namespace === "secrets"
        ? "secrets are only injected inside steps — move the check into a run command"
        : "the matrix expands after jobs.<id>.if is evaluated";
    throw new GithubTargetError(
      `'${namespace}.${field}' in a step condition cannot resolve at jobs.<id>.if — ${hint}`,
      "LOWER_FAILED",
    );
  }
  return stripBraces(translateContextRef(namespace, field));
}

/** env.X inside a job gate — inlines only own-key static literals. */
function translateEnvConditionRef(
  field: string,
  jobEnv: Readonly<Record<string, string>> | undefined,
  jobSecrets: readonly string[] | undefined,
): string {
  if (jobSecrets?.includes(field)) {
    throw new GithubTargetError(
      `'env.${field}' in a step condition cannot resolve at jobs.<id>.if — '${field}' is shadowed by runtime.secrets and secrets are only injected inside steps`,
      "LOWER_FAILED",
    );
  }
  const literal =
    jobEnv !== undefined && Object.hasOwn(jobEnv, field)
      ? jobEnv[field]
      : undefined;
  if (literal === undefined) {
    throw new GithubTargetError(
      `'env.${field}' in a step condition cannot resolve at jobs.<id>.if — declare '${field}' in the step's runtime.env so the literal can be inlined`,
      "LOWER_FAILED",
    );
  }
  if (literal.includes("${")) {
    throw new GithubTargetError(
      `'env.${field}' in a step condition cannot resolve at jobs.<id>.if — '${field}' holds a dynamic expression; gate on a static literal or move the check into a run command`,
      "LOWER_FAILED",
    );
  }
  return `'${literal.replace(/'/g, "''")}'`;
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
function buildInputLookup(
  inputs: readonly Reference[],
): Map<string, Reference> {
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
      return translateContextRef(ref.namespace, ref.field);
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
  jobEnv?: Readonly<Record<string, string>>,
  jobSecrets?: readonly string[],
): string {
  if (condition.kind === "status") {
    // GitHub status conditions map to built-in condition functions
    if (condition.status === "always") return "${{ always() }}";
    if (condition.status === "never") return "${{ false }}";
    if (condition.status === "failure") return "${{ failure() }}";
    return "${{ success() }}";
  }
  if (condition.kind === "context") {
    return `\${{ ${translateConditionContextRef(condition.namespace, condition.field, jobEnv, jobSecrets)} }}`;
  }
  if (condition.kind === "step") {
    return translateStepRef(condition, jobIdMap);
  }
  // Expression — translate each ${...} placeholder
  const lookup = buildInputLookup(condition.refs);
  const translated = condition.template.replace(
    /\$\{([^{}]+)\}/g,
    (_, key: string) => {
      const ref = lookup.get(key);
      if (ref === undefined) return `\${${key}}`;
      if (ref.kind === "context") {
        return translateConditionContextRef(
          ref.namespace,
          ref.field,
          jobEnv,
          jobSecrets,
        );
      }
      return stripBraces(translateStepRef(ref, jobIdMap));
    },
  );
  return `\${{ ${translated} }}`;
}

/** Strip the `${{ ... }}` wrapper, returning the inner expression. */
function stripBraces(s: string): string {
  // Match ${{ ... }} and extract inner content, trimming whitespace.
  // Uses anchored pattern without nested quantifiers to avoid ReDoS.
  if (!s.startsWith("${{") || !s.endsWith("}}")) return s;
  return s.slice(3, -2).trim();
}
