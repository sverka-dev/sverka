// @sverka/sdk — public API. Spec 03.
//
// During the v0 redesign, this file exports the OLD SDK API as a compat
// layer so the CLI and user config files continue to work. The new SDK
// API ($, shell, artifact, pipeline, when, image, images, context) is exported
// from ./v0/index.js and will take over the top-level exports when Wave L
// rebuilds the CLI.


export * from "./planner/index.js";
// ── Compat: old @sverka/sdk API ────────────────────────────────────
export { pipeline, run, parallel, when, matrix, workflow } from "@sverka/workflow";
export type { Operation, OperationKind, OperationSpec, Workflow, Runtime, RuntimeMode, RuntimeResult, OperationOutcome, PlanContext, Artifact, CacheDeclaration, ArtifactDeclaration, NetworkPolicy, CredentialDeclaration } from "@sverka/workflow";
export { CoreError, PlanningError, CompositionError } from "@sverka/workflow";
export type { Plan, PlanOperation, PlanMetadata, ExecutorSpec } from "@sverka/workflow";
export { validatePlan, computePlanId } from "@sverka/workflow";
export { createPlanner } from "./planner/index.js";
export type { Planner, DiscoverOptions, ProjectContext, PlanProposal, ProposedCheck, DiscoveryExplanation } from "./planner/index.js";
export type { Finding, Severity, FindingSource } from "@sverka/verification";
export { normalizeSarif, computeFingerprint } from "@sverka/verification";
export { createBaseline, updateBaseline, loadBaseline, saveBaseline, filterOnlyNew } from "@sverka/verification";
export type { Verdict, Policy, FailOnRule, PolicyResult, PolicyConfig } from "@sverka/verification";
export { DEFAULT_POLICY, createPolicy, evaluatePolicy } from "@sverka/verification";
export type { CheckResolver, ResolvedCheck, CheckOutput } from "@sverka/verification";
export { createBuiltinResolver, extractFindings } from "@sverka/verification";
export { CheckError, type CheckErrorCode } from "@sverka/verification";
export { SdkError, type SdkErrorCode } from "./errors.js";
export type {
  WorkflowDefinition,
  SverkaOptions,
  Sverka,
  PlanResult,
  ExecutionResult,
} from "./compat/types.js";
export { findConfig, loadWorkflow } from "./compat/config.js";
export { createSverka, plan, toPlan, execute } from "./compat/sverka.js";
export { task, defineWorkflow } from "./compat/helpers.js";

// ── New SDK API (v0) — available under /v0 subpath ─────────────────
export { $ } from "./dollar.js";
export type { StepBuilder } from "./dollar.js";
export { shell } from "./shell.js";
export type { ShellProxy } from "./shell.js";
export { artifact } from "./artifact.js";
export { pipeline as pipelineV0 } from "./pipeline.js";
export type { PipelineConfig } from "./pipeline.js";
export { callPipeline } from "./call-pipeline.js";
export type { CallPipelineBuilder } from "./call-pipeline.js";
export { component } from "./component.js";
export type { ComponentBuilder } from "./component.js";
export { when as whenV0 } from "./when.js";
export { expr } from "./expr.js";
export { status } from "./status.js";
export { image, images } from "./images.js";
export type { ImageRef } from "./images.js";
export { env, secrets, git, change, event, run as runContext, inputs, matrix as matrixContext } from "./context.js";
export type { Expression } from "@sverka/workflow";
export { agent } from "./agent.js";
export type { AgentStepBuilder } from "./agent.js";
