// @sverka/sdk — public API

// ── Re-exports: core composables ──────────────────────────────────
export { pipeline, run, parallel, when, matrix, workflow } from "@sverka/core";

// ── Re-exports: core types ────────────────────────────────────────
export type {
  Operation,
  OperationKind,
  OperationSpec,
  Workflow,
  Runtime,
  RuntimeMode,
  RuntimeResult,
  OperationOutcome,
  PlanContext,
  Artifact,
  CacheDeclaration,
  ArtifactDeclaration,
  NetworkPolicy,
  CredentialDeclaration,
} from "@sverka/core";

export { CoreError, PlanningError, CompositionError } from "@sverka/core";

// ── Re-exports: IR types ──────────────────────────────────────────
export type {
  Plan,
  PlanOperation,
  PlanMetadata,
  ExecutorSpec,
} from "@sverka/ir";
export { validatePlan, computePlanId } from "@sverka/ir";

// ── Re-exports: runtime ───────────────────────────────────────────
export { Scheduler, type SchedulerConfig } from "@sverka/runtime";
export type {
  Executor,
  ExecuteRequest,
  ExecuteResult,
} from "@sverka/runtime";
export type {
  ExecutionResult as RuntimeExecutionResult,
  OperationOutcome as RuntimeOperationOutcome,
  ExecutionState,
} from "@sverka/runtime";

// ── Re-exports: planner ───────────────────────────────────────────
export { createPlanner } from "@sverka/planner";
export type {
  Planner,
  DiscoverOptions,
  ProjectContext,
  PlanProposal,
  ProposedCheck,
  DiscoveryExplanation,
} from "@sverka/planner";

// ── Re-exports: findings ──────────────────────────────────────────
export type { Finding, Severity, FindingSource } from "@sverka/findings";
export { normalizeSarif, computeFingerprint } from "@sverka/findings";
export {
  createBaseline,
  updateBaseline,
  loadBaseline,
  saveBaseline,
  filterOnlyNew,
} from "@sverka/findings";

// ── Re-exports: policy ────────────────────────────────────────────
export type {
  Verdict,
  Policy,
  FailOnRule,
  PolicyResult,
  PolicyConfig,
} from "@sverka/policy";
export { DEFAULT_POLICY, createPolicy, evaluatePolicy } from "@sverka/policy";

// ── Re-exports: checks ────────────────────────────────────────────
export type {
  CheckResolver,
  ResolvedCheck,
  CheckOutput,
} from "@sverka/checks";
export { createBuiltinResolver, extractFindings } from "@sverka/checks";
export { CheckError, type CheckErrorCode } from "@sverka/checks";

// ── SDK errors ────────────────────────────────────────────────────
export { SdkError, type SdkErrorCode } from "./errors.js";

// ── SDK types ─────────────────────────────────────────────────────
export type {
  WorkflowDefinition,
  SverkaOptions,
  Sverka,
  PlanResult,
  ExecutionResult,
} from "./types.js";

// ── Config discovery and loading ──────────────────────────────────
export { findConfig, loadWorkflow } from "./config.js";

// ── Sverka instance ───────────────────────────────────────────────
export { createSverka, plan, execute } from "./sverka.js";

// ── task helper ───────────────────────────────────────────────────
import type { Operation } from "@sverka/core";

/**
 * Name an operation. Sugar for `op.named(name)`.
 * @example
 * pipeline(task("lint", run({ command: "bun", args: ["run", "lint"] })))
 */
export function task(name: string, op: Operation): Operation {
  return op.named(name);
}

// ── Workflow definition ───────────────────────────────────────────
import type { WorkflowDefinition } from "./types.js";

/**
 * Type-safe helper for sverka.config.ts. Identity function.
 */
export function defineWorkflow(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  return definition;
}
