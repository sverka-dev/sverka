import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { OperationSpec, Workflow, Operation, ArtifactDeclaration } from "@sverka/core";
import { workflow as makeWorkflow } from "@sverka/core";
import type { Plan } from "@sverka/ir";
import { validatePlan } from "@sverka/ir";
import { createPlanner } from "@sverka/planner";
import type { ProjectContext } from "@sverka/planner";
import { Scheduler } from "@sverka/runtime";
import type { Executor, ExecutionResult as RuntimeExecutionResult } from "@sverka/runtime";
import { HostExecutor, createAllowlist } from "@sverka/runtime-host";
import { DockerExecutor } from "@sverka/runtime-docker";
import { DEFAULT_POLICY, createPolicy, evaluatePolicy } from "@sverka/policy";
import type { Policy } from "@sverka/policy";
import { loadBaseline, filterOnlyNew } from "@sverka/findings";
import type { Finding } from "@sverka/findings";
import { createBuiltinResolver, extractFindings } from "@sverka/checks";
import type { CheckResolver, ResolvedCheck } from "@sverka/checks";

import type {
  SverkaOptions,
  Sverka,
  PlanResult,
  ExecutionResult,
  WorkflowDefinition,
} from "./types.js";
import { SdkError } from "./errors.js";
import { findConfig, loadWorkflow } from "./config.js";
import { convertToPlan } from "./convert.js";
import { PlanRuntime } from "./internal/plan-runtime.js";

/**
 * Create a Sverka instance with default options pre-applied. Per-call
 * options override defaults.
 */
export function createSverka(defaultOptions?: SverkaOptions): Sverka {
  return {
    async plan(options?: SverkaOptions): Promise<PlanResult> {
      return doPlan(mergeOptions(defaultOptions, options));
    },
    async toPlan(options?: SverkaOptions): Promise<Plan> {
      return buildPlan(mergeOptions(defaultOptions, options));
    },
    async execute(options?: SverkaOptions): Promise<ExecutionResult> {
      return doExecute(mergeOptions(defaultOptions, options));
    },
  };
}

/** Top-level plan convenience function. */
export async function plan(options?: SverkaOptions): Promise<PlanResult> {
  return doPlan(options ?? {});
}

/** Top-level toPlan convenience function. Returns the canonical Plan IR. */
export async function toPlan(options?: SverkaOptions): Promise<Plan> {
  return buildPlan(options ?? {});
}

/** Top-level execute convenience function. */
export async function execute(options?: SverkaOptions): Promise<ExecutionResult> {
  return doExecute(options ?? {});
}

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------

async function doPlan(options: SverkaOptions): Promise<PlanResult> {
  const root = options.root ?? process.cwd();
  const planner = createPlanner();
  const context = await planner.discover({
    root,
    ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
  });

  const configPath = await resolveConfigPath(options, root);
  if (configPath !== null) {
    const def = await loadWorkflow(configPath, root);
    const operations = await evaluateWorkflow(def);
    const plan = buildPlanFromOps(operations, def.name, context);
    return { context, operations, proposal: null, plan };
  }

  // Auto-discovery mode.
  const proposal = await planner.plan(context);
  const resolver = options.resolver ?? createBuiltinResolver();
  const operations: OperationSpec[] = [];
  for (const check of proposal.checks) {
    try {
      const r = resolver.resolve(check, context);
      if (r !== null) operations.push(r.operation);
    } catch {
      // Skip checks whose custom resolver fails and continue with the rest.
    }
  }
  const plan = buildPlanFromOps(operations, "sverka-plan", context);
  return { context, operations, proposal, plan };
}

/** Build a canonical Plan IR from resolved operations. */
async function buildPlan(options: SverkaOptions): Promise<Plan> {
  const result = await doPlan(options);
  return result.plan;
}

/** Convert operations into a validated Plan with host executor defaults. */
function buildPlanFromOps(
  operations: readonly OperationSpec[],
  name: string,
  context: ProjectContext,
): Plan {
  const plan = convertToPlan(operations, {
    name,
    executor: "host",
    context,
  });

  if (operations.length > 0) {
    const validation = validatePlan(plan);
    if (!validation.valid) {
      throw new SdkError(
        `plan validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        "EXECUTION_FAILED",
      );
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Execute mode
// ---------------------------------------------------------------------------

async function doExecute(options: SverkaOptions): Promise<ExecutionResult> {
  const root = options.root ?? process.cwd();
  const executorType: "host" | "docker" = options.executor ?? "host";
  const planner = createPlanner();
  const context: ProjectContext = await planner.discover({
    root,
    ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
  });

  const { def, operations, resolvedChecks, planName } = await resolveOperations(
    options,
    root,
    context,
    executorType,
  );
  const plan = buildAndValidatePlan(operations, planName, executorType, context);
  const { runtimeResult, findings } = await runPlan(
    plan,
    resolvedChecks,
    root,
    executorType,
  );
  return buildExecutionResult(runtimeResult, findings, options, def);
}

/** Load or auto-discover the operations to execute. */
async function resolveOperations(
  options: SverkaOptions,
  root: string,
  context: ProjectContext,
  executorType: "host" | "docker",
): Promise<{ def: WorkflowDefinition | null; operations: readonly OperationSpec[]; resolvedChecks: readonly ResolvedCheck[]; planName: string }> {
  const configPath = await resolveConfigPath(options, root);

  if (configPath !== null) {
    const def = await loadWorkflow(configPath, root);
    const operations = await evaluateWorkflow(def);
    return { def, operations, resolvedChecks: [], planName: def.name };
  }

  const proposal = await createPlanner().plan(context);
  const resolver = options.resolver ?? createBuiltinResolver();
  const tmpChecks: ResolvedCheck[] = [];
  for (const check of proposal.checks) {
    try {
      const r = resolver.resolve(check, context);
      if (r !== null) tmpChecks.push(r);
    } catch {
      // Skip checks whose custom resolver fails and continue with the rest.
    }
  }

  if (executorType === "docker" && tmpChecks.some((r) => r.operation.image === undefined)) {
    throw new SdkError(
      "docker executor requires container images; every operation must declare an image",
      "EXECUTION_FAILED",
    );
  }

  const operations = tmpChecks.map((r) => buildOperationWithOutputs(r));
  if (operations.length === 0) {
    throw new SdkError(
      "no config found and auto-discovery produced no resolvable checks",
      "CONFIG_NOT_FOUND",
    );
  }

  return { def: null, operations, resolvedChecks: tmpChecks, planName: "sverka-plan" };
}

/** Convert operations into a Plan and validate it. */
function buildAndValidatePlan(
  operations: readonly OperationSpec[],
  planName: string,
  executorType: "host" | "docker",
  context: ProjectContext,
): Plan {
  const plan = convertToPlan(operations, {
    name: planName,
    executor: executorType,
    context,
  });

  // Validate (skip for empty operations — auto-discovery with no commands).
  if (operations.length > 0) {
    const validation = validatePlan(plan);
    if (!validation.valid) {
      throw new SdkError(
        `plan validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        "EXECUTION_FAILED",
      );
    }
  }

  return plan;
}

/** Execute a Plan and extract findings from resolved checks. */
async function runPlan(
  plan: Plan,
  resolvedChecks: readonly ResolvedCheck[],
  root: string,
  executorType: "host" | "docker",
): Promise<{ runtimeResult: RuntimeExecutionResult; findings: readonly Finding[] }> {
  const artifactDir = mkdtempSync(join(tmpdir(), "sverka-artifacts-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "sverka-cache-"));

  try {
    const executor = createExecutor(executorType, cacheDir, plan.operations);
    const scheduler = new Scheduler({
      executors: [executor],
      maxConcurrent: 4,
      workspace: root,
      artifactDir,
      cacheDir,
      credentials: {},
      resume: false,
    });

    try {
      const runtimeResult = await scheduler.execute(plan);
      const findings = await extractResolvedFindings(resolvedChecks, artifactDir);
      return { runtimeResult, findings };
    } catch (e) {
      throw new SdkError(
        `execution failed: ${e instanceof Error ? e.message : String(e)}`,
        "EXECUTION_FAILED",
        e,
      );
    } finally {
      await scheduler.dispose().catch(() => {});
    }
  } finally {
    await Promise.all([
      rm(artifactDir, { recursive: true, force: true }).catch(() => {}),
      rm(cacheDir, { recursive: true, force: true }).catch(() => {}),
    ]);
  }
}

/** Extract findings from resolved checks' SARIF output artifacts. */
async function extractResolvedFindings(
  resolvedChecks: readonly ResolvedCheck[],
  artifactDir: string,
): Promise<readonly Finding[]> {
  const all: Finding[] = [];
  for (const r of resolvedChecks) {
    if (r.outputs.length === 0) continue;
    const extracted = await extractFindings(r.outputs, artifactDir, r.checkId);
    all.push(...extracted);
  }
  return all;
}

/** Build the final ExecutionResult from runtime output and user options. */
async function buildExecutionResult(
  runtimeResult: RuntimeExecutionResult,
  findings: readonly Finding[],
  options: SverkaOptions,
  def: WorkflowDefinition | null,
): Promise<ExecutionResult> {
  let baselineFingerprints: readonly string[] = [];
  let filteredFindings: readonly Finding[] = findings;
  if (options.baselinePath) {
    const baseline = await loadBaseline(options.baselinePath);
    baselineFingerprints = baseline.fingerprints;
    filteredFindings = options.onlyNew
      ? filterOnlyNew(findings, baseline)
      : findings;
  }

  const policy: Policy = def?.policy
    ? createPolicy(def.policy)
    : DEFAULT_POLICY;
  const policyResult = evaluatePolicy(filteredFindings, policy, baselineFingerprints);

  const verdict = runtimeResult.status === "success"
    ? policyResult.verdict
    : "fail";

  return {
    findings: filteredFindings,
    policyResult,
    verdict,
    status: runtimeResult.status,
    ...(runtimeResult.runtimeFailure
      ? { runtimeFailure: runtimeResult.runtimeFailure }
      : {}),
    outcomes: runtimeResult.outcomes,
    durationMs: runtimeResult.durationMs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeOptions(
  defaults: SverkaOptions | undefined,
  callOpts: SverkaOptions | undefined,
): SverkaOptions {
  return { ...defaults, ...callOpts };
}

async function resolveConfigPath(
  options: SverkaOptions,
  root: string,
): Promise<string | null> {
  if (options.configPath) {
    return options.configPath;
  }
  return findConfig(root);
}

async function evaluateWorkflow(
  def: WorkflowDefinition,
): Promise<readonly OperationSpec[]> {
  const wf = normalizeWorkflow(def.name, def.workflow);
  const runtime = new PlanRuntime();
  const result = await wf.plan(runtime);
  return result.operations;
}

/**
 * Normalize a WorkflowDefinition's workflow field to a Workflow.
 * If it's already a Workflow (has `roots` and `plan`), return as-is.
 * If it's a bare Operation, wrap it with `workflow(name, op)`.
 */
function normalizeWorkflow(name: string, wf: Workflow | Operation): Workflow {
  if (isWorkflow(wf)) {
    return wf;
  }
  // It's an Operation — wrap it.
  return makeWorkflow(name, wf);
}

function isWorkflow(wf: Workflow | Operation): wf is Workflow {
  return "roots" in wf && "plan" in wf;
}

function createExecutor(
  type: "host" | "docker",
  cacheDir: string,
  operations: readonly { command?: string }[],
): Executor {
  if (type === "docker") {
    return new DockerExecutor({
      runAs: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      cacheDir,
    });
  }
  const commands = operations
    .map((op) => op.command)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  return new HostExecutor({
    enabled: true,
    allowlist: createAllowlist(commands),
    envAllowlist: ["PATH"],
  });
}

/** Merge resolved-check outputs into the operation's artifact declarations. */
function buildOperationWithOutputs(r: ResolvedCheck): OperationSpec {
  if (r.outputs.length === 0) {
    return r.operation;
  }
  const artifacts: ArtifactDeclaration[] = [
    ...(r.operation.artifacts ?? []),
    ...r.outputs.map((o) => ({ path: o.path, retain: false })),
  ];
  return { ...r.operation, artifacts };
}
