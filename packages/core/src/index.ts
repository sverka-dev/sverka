// @sverka/core — public API

export {
  type Operation,
  type OperationKind,
  type OperationSpec,
  type CacheDeclaration,
  type ArtifactDeclaration,
  type NetworkPolicy,
  type CredentialDeclaration,
} from "./operation.js";
export {
  type Runtime,
  type RuntimeMode,
  type RuntimeResult,
  type RuntimeFinalization,
  type OperationOutcome,
  type PlanContext,
  type Artifact,
} from "./runtime.js";
export { pipeline } from "./composables/pipeline.js";
export { run } from "./composables/run.js";
export { parallel } from "./composables/parallel.js";
export { when } from "./composables/when.js";
export { matrix } from "./composables/matrix.js";
export { workflow, type Workflow } from "./composables/workflow.js";
export { CoreError, PlanningError, CompositionError } from "./errors.js";
export { canonicalStringify } from "./internal/canonical.js";
