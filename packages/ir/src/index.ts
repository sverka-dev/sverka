// @sverka/ir — public API

export { type Plan, type PlanOperation, type PlanMetadata } from "./plan.js";
export {
  type ExecutorSpec,
  type RemoteExecutorRef,
  type ResourceLimits,
  type NetworkPolicy,
  type CredentialDeclaration,
  type CacheDeclaration,
  type ArtifactDeclaration,
  type RetryPolicy,
} from "./plan.js";
export {
  type PlanValidator,
  type ValidationResult,
  type ValidationErrorDetail,
  validatePlan,
} from "./validate.js";
export { serializePlan, deserializePlan } from "./serialize.js";
export { computePlanId, computeOperationId } from "./ids.js";
export { IRError, ValidationError, SerializationError } from "./errors.js";
export { PLAN_SCHEMA_VERSION } from "./version.js";
