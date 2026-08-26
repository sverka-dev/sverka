// Native lowering: Definition Graph → GithubTargetGraph.
// Spec 08 — §18.1, §19.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  EntryDefinition,
  OperationDefinition,
  Dependency,
  Reference,
  Expression,
} from "@sverka/core";
import type { Trigger, MatrixSpec, StepRef, StatusCondition } from "@sverka/cdk";
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
    name: pipeline.name ?? pipeline.id,
    ...(pipeline.runName !== undefined ? { runName: pipeline.runName } : {}),
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
 * Multiple entries of the same kind have their filters merged.
 */
function lowerTriggers(entries: readonly EntryDefinition[]): GithubTriggers {
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
}

function assembleTriggers(f: TriggerFilters): GithubTriggers {
  const triggers: Record<string, unknown> = {};
  const push = assemblePushTrigger(f);
  if (push) triggers.push = push;
  const pr = assemblePullRequestTrigger(f);
  if (pr) triggers.pull_request = pr;
  if (f.hasManual) triggers.workflow_dispatch = null;
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
  const { steps: rawSteps, outputs } = lowerOperations(step, jobIdMap);

  // Apply continueOnError and shell to all run steps (not Checkout/uses steps).
  // GitHub Actions continue-on-error only accepts a boolean; the
  // { exitCodes } variant is GitLab-specific and must be rejected.
  if (step.continueOnError !== undefined && typeof step.continueOnError !== "boolean") {
    throw new GithubTargetError(
      `step '${step.id}' uses exit-code continueOnError which is not supported by GitHub Actions`,
      "LOWER_FAILED",
    );
  }
  const steps =
    step.continueOnError !== undefined || step.runtime.shell !== undefined
      ? rawSteps.map((s) => {
          if (s.run === undefined) return s;
          return {
            ...s,
            ...(step.continueOnError !== undefined
              ? {
                  continueOnError: step.continueOnError,
                }
              : {}),
            ...(step.runtime.shell !== undefined ? { shell: step.runtime.shell } : {}),
          };
        })
      : rawSteps;

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
    ...(step.matrix !== undefined ? { strategy: lowerStrategy(step.matrix) } : {}),
    ...(Object.keys(outputs).length > 0 ? { outputs } : {}),
    ...(step.condition !== undefined ? { if: lowerCondition(step.condition, jobIdMap) } : {}),
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
function lowerOperations(
  step: StepDefinition,
  jobIdMap: Map<string, string>,
): { steps: readonly GithubStep[]; outputs: Record<string, string> } {
  const steps: GithubStep[] = [];
  const outputs: Record<string, string> = {};
  const shortStepId = step.id.includes("/") ? step.id.split("/").pop()! : step.id;

  // Every job needs the repository checked out.
  steps.push({
    name: "Checkout",
    uses: "actions/checkout@v4",
  });

  // beforeScript → run steps before main operations (translated for context refs).
  if (step.beforeScript) {
    for (const cmd of step.beforeScript) {
      steps.push({ run: translateCommand(cmd, step.inputs, jobIdMap) });
    }
  }

  let runLines: string[] = [];
  let hasExportInRun = false;
  let outputBlockIndex = 0;

  function flushRun(): void {
    if (runLines.length === 0) return;
    const combined = runLines.join("\n");
    const translated = translateCommand(combined, step.inputs, jobIdMap);
    // If this run block contains exportOutput lines, give it a unique id so
    // job outputs can reference ${{ steps.<id>.outputs.* }}. Multiple
    // output-producing blocks (separated by non-shell ops) get distinct IDs.
    let outputStepId: string | undefined;
    if (hasExportInRun) {
      outputStepId =
        outputBlockIndex === 0
          ? `${shortStepId}-outputs`
          : `${shortStepId}-outputs-${outputBlockIndex + 1}`;
    }
    steps.push({
      run: translated,
      ...(outputStepId !== undefined ? { id: outputStepId } : {}),
      ...(step.runtime.workingDir ? { workingDirectory: step.runtime.workingDir } : {}),
      ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
    });
    if (hasExportInRun) outputBlockIndex++;
    runLines = [];
    hasExportInRun = false;
  }

  for (const op of step.operations) {
    if (op.kind === "exportOutput") {
      runLines.push(`echo "${op.name}=\${${op.name}}" >> "$GITHUB_OUTPUT"`);
      const outputStepId =
        outputBlockIndex === 0
          ? `${shortStepId}-outputs`
          : `${shortStepId}-outputs-${outputBlockIndex + 1}`;
      outputs[op.name] = `\${{ steps.${outputStepId}.outputs.${op.name} }}`;
      hasExportInRun = true;
    } else {
      lowerOperation(op, shortStepId, steps, runLines, flushRun);
    }
  }

  flushRun();

  // afterScript → run steps after main operations with if: always() (translated).
  if (step.afterScript) {
    for (const cmd of step.afterScript) {
      steps.push({ run: translateCommand(cmd, step.inputs, jobIdMap), if: "always()" });
    }
  }

  return { steps, outputs };
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
  if (spec.maxParallel !== undefined) {
    if (!Number.isInteger(spec.maxParallel) || spec.maxParallel < 1) {
      throw new GithubTargetError(
        `matrix maxParallel must be a positive integer, got ${spec.maxParallel}`,
        "LOWER_FAILED",
      );
    }
  }
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
    ...(spec.maxParallel !== undefined ? { maxParallel: spec.maxParallel } : {}),
  };
}

// ---------------------------------------------------------------------------
// Context ref translation (F-35)
// ---------------------------------------------------------------------------

const GITHUB_CONTEXT_MAP: Readonly<Record<string, string>> = {
  "git.sha": "github.sha",
  "git.branch": "github.ref_name",
  "git.tag": "(github.ref_type == 'tag' && github.ref_name || '')",
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
 * Secrets are emitted as env var references ($FIELD) in commands to avoid
 * exposing secret values in logs. In conditions, secrets are not supported
 * by GitHub's if: context and are emitted as env var references instead.
 */
function translateContextRef(namespace: string, field: string, inCondition = false): string {
  const key = `${namespace}.${field}`;
  const mapped = GITHUB_CONTEXT_MAP[key];
  if (mapped) return `\${{ ${mapped} }}`;
  // env.X → ${{ env.FIELD }} (GitHub env context)
  if (namespace === "env") {
    return `\${{ env.${field} }}`;
  }
  // inputs.X → ${{ env.FIELD }} (pipeline inputs are lowered to workflow env)
  if (namespace === "inputs") {
    return `\${{ env.${field} }}`;
  }
  if (namespace === "matrix") {
    return `\${{ matrix.${field} }}`;
  }
  // secrets.X in commands → $FIELD (env var, avoids exposing value in run logs)
  // secrets.X in conditions → not supported by GitHub if: context
  if (namespace === "secrets") {
    if (inCondition) {
      // GitHub does not support secrets context in if: expressions.
      // Use env var reference instead (secret is injected as env var).
      return `\${{ env.${field} }}`;
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
