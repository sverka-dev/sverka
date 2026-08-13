// @sverka/ir — public API. Spec 06.

export type { SerializableGraph } from "./serialize.js";
export type { RunPlan, BoundEntry, InputValue } from "./run-plan.js";

export {
  serializeGraph,
  deserializeGraph,
  serializeRunPlan,
  deserializeRunPlan,
} from "./serialize.js";

export { computeGraphId, computeRunPlanId } from "./ids.js";

export { validateGraphSchema, validateRunPlanSchema } from "./validate.js";

export { IRError, ValidationError, SerializationError } from "./errors.js";
export type { IRErrorCode } from "./errors.js";

export { GRAPH_SCHEMA_VERSION, RUN_PLAN_SCHEMA_VERSION } from "./version.js";

// ── Compat: old @sverka/ir API (used by runtime, sdk, compilers until rebuilt) ──
export type { Plan, PlanOperation, PlanMetadata } from "./compat/plan.js";
export type {
  ExecutorSpec,
  RemoteExecutorRef,
  ResourceLimits,
  NetworkPolicy,
  CredentialDeclaration,
  CacheDeclaration,
  RetryPolicy,
  ArtifactDeclaration,
} from "./compat/plan.js";
export { computePlanId, computeOperationId } from "./compat/ids.js";
export { serializePlan, deserializePlan } from "./compat/serialize.js";
export { validatePlan } from "./compat/validate.js";
export type { ValidationResult, ValidationErrorDetail } from "./compat/validate.js";
export { PLAN_SCHEMA_VERSION } from "./compat/version.js";
