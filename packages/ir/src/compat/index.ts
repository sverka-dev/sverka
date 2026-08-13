// Compat: old @sverka/ir API (Plan, PlanOperation, computePlanId, etc.)
// Used by runtime, sdk, compiler-github, compiler-gitlab until rebuilt.
// Removed when no downstream package depends on it.

export type { Plan, PlanOperation, PlanMetadata } from "./plan.js";
export type {
  ExecutorSpec,
  RemoteExecutorRef,
  ResourceLimits,
  NetworkPolicy,
  CredentialDeclaration,
  CacheDeclaration,
  RetryPolicy,
  ArtifactDeclaration,
} from "./plan.js";

export { computePlanId, computeOperationId } from "./ids.js";
export { serializePlan, deserializePlan } from "./serialize.js";
export { validatePlan, type ValidationResult, type ValidationErrorInfo } from "./validate.js";
export { IRError, ValidationError, SerializationError } from "./errors.js";
export { PLAN_SCHEMA_VERSION } from "./version.js";

