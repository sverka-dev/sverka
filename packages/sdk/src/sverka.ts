import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { OperationSpec, Workflow, Operation } from "@sverka/core";
import { workflow as makeWorkflow } from "@sverka/core";
import type { Plan } from "@sverka/ir";
import { validatePlan } from "@sverka/ir";
import { createPlanner } from "@sverka/planner";
import type { Planner, ProjectContext } from "@sverka/planner";
import { Scheduler } from "@sverka/runtime";
import type { Executor, ExecutionResult as RuntimeExecutionResult } from "@sverka/runtime";
import { HostExecutor } from "@sverka/runtime-host";
import type { CommandAllowlist } from "@sverka/runtime-host";
import { DockerExecutor } from "@sverka/runtime-docker";
import { DEFAULT_POLICY, createPolicy, evaluatePolicy } from "@sverka/policy";
import type { Policy } from "@sverka/policy";
import { loadBaseline, filterOnlyNew } from "@sverka/findings";
import type { Finding } from "@sverka/findings";

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

/** Allowlist that permits any command (the SDK is the user's own tool). */
const allowAllCommands: CommandAllowlist = {
  entries: ["*"],
  isAllowed: () => true,
};

/**
 * Create a Sverka instance with default options pre-applied. Per-call
 * options override defaults.
 */
export function createSverka(defaultOptions?: SverkaOptions): Sverka {
  return {
    async plan(options?: SverkaOptions): Promise<PlanResult> {
      return doPlan(mergeOptions(defaultOptions, options));
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
    const def = await loadWorkflow(configPath);
    const operations = await evaluateWorkflow(def);
    return { context, operations, proposal: null };
  }

  // Auto-discovery mode.
  const proposal = await planner.plan(context);
  return { context, operations: [], proposal };
}

// ---------------------------------------------------------------------------
// Execute mode
// ---------------------------------------------------------------------------

async function doExecute(options: SverkaOptions): Promise<ExecutionResult> {
  const root = options.root ?? process.cwd();
  const executorType = options.executor ?? "host";
  const planner = createPlanner();
  const context = await planner.discover({
    root,
    ...(options.baseRef !== undefined ? { baseRef: options.baseRef } : {}),
  });

  const configPath = await resolveConfigPath(options, root);
  const { operations, planName, def } = await resolveExecutionOperations(
    options,
    planner,
    context,
    configPath,
  );

  const plan = buildAndValidatePlan(operations, planName, executorType, context);
  const runtimeResult = await executePlan(plan, executorType, root);
  return buildExecutionResult(options, runtimeResult, def);
}

async function resolveExecutionOperations(
  options: SverkaOptions,
  planner: Planner,
  context: ProjectContext,
  configPath: string | null,
): Promise<{
  operations: readonly OperationSpec[];
  planName: string;
  def: WorkflowDefinition | null;
}> {
  if (configPath !== null) {
    const def = await loadWorkflow(configPath);
    const operations = await evaluateWorkflow(def);
    return { operations, planName: def.name, def };
  }

  // Auto-discovery: check if planner found anything actionable.
  const proposal = await planner.plan(context);
  if (proposal.checks.length === 0) {
    throw new SdkError(
      "no config found and auto-discovery produced no checks",
      "CONFIG_NOT_FOUND",
    );
  }
  // ProposedChecks have no commands yet (wave 11 adds check providers).
  // Run with empty operations — the pipeline is wired, findings populate later.
  return { operations: [], planName: "sverka-plan", def: null };
}

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

async function executePlan(
  plan: Plan,
  executorType: "host" | "docker",
  root: string,
): Promise<RuntimeExecutionResult> {
  const artifactDir = mkdtempSync(join(tmpdir(), "sverka-artifacts-"));
  const cacheDir = mkdtempSync(join(tmpdir(), "sverka-cache-"));
  const executor = createExecutor(executorType, cacheDir);

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
    return await scheduler.execute(plan);
  } catch (e) {
    throw new SdkError(
      `execution failed: ${e instanceof Error ? e.message : String(e)}`,
      "EXECUTION_FAILED",
      e,
    );
  } finally {
    await scheduler.dispose().catch(() => {});
    await Promise.all([
      rm(artifactDir, { recursive: true, force: true }).catch(() => {}),
      rm(cacheDir, { recursive: true, force: true }).catch(() => {}),
    ]);
  }
}

async function buildExecutionResult(
  options: SverkaOptions,
  runtimeResult: RuntimeExecutionResult,
  def: WorkflowDefinition | null,
): Promise<ExecutionResult> {
  const findings: readonly Finding[] = [];
  const { filteredFindings, baselineFingerprints } = await filterFindings(
    options,
    findings,
  );

  const policy: Policy = def?.policy
    ? createPolicy(def.policy)
    : DEFAULT_POLICY;
  const policyResult = evaluatePolicy(
    filteredFindings,
    policy,
    baselineFingerprints,
  );

  const verdict = runtimeResult.status === "success"
    ? policyResult.verdict
    : "fail";

  return {
    findings: filteredFindings,
    policyResult,
    verdict,
    status: runtimeResult.status,
    outcomes: runtimeResult.outcomes,
    durationMs: runtimeResult.durationMs,
  };
}

async function filterFindings(
  options: SverkaOptions,
  findings: readonly Finding[],
): Promise<{
  filteredFindings: readonly Finding[];
  baselineFingerprints: readonly string[];
}> {
  if (!options.baselinePath) {
    return { filteredFindings: findings, baselineFingerprints: [] };
  }
  const baseline = await loadBaseline(options.baselinePath);
  return {
    filteredFindings: options.onlyNew
      ? filterOnlyNew(findings, baseline)
      : findings,
    baselineFingerprints: baseline.fingerprints,
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
): Executor {
  if (type === "docker") {
    return new DockerExecutor({
      runAs: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      cacheDir,
    });
  }
  return new HostExecutor({
    enabled: true,
    allowlist: allowAllCommands,
    envAllowlist: [],
  });
}
