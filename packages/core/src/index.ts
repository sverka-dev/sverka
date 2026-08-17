// Public exports for @sverka/core. Spec 02, 05.

// ── New: Definition Graph model + synthesis ────────────────────────
export type {
  DefinitionGraph,
  ProjectDefinition,
  PipelineDefinition,
  PipelineInputDefinition,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
  OutputDefinition,
  PipelineOutputDefinition,
  PipelineCall,
  ComponentRef,
  ChildPipelineTrigger,
  DownstreamTrigger,
  PipelineRule,
  IncludeRef,
  Input,
  InputLiteral,
  OutputDeclaration,
  OutputType,
  Reference,
  Expression,
  Trigger,
  MatrixSpec,
  MatrixValue,
  Condition,
  ContinueOnError,
  RetryPolicy,
  PermissionLevel,
  RunnerSpec,
  IdentitySpec,
  Rule,
  PipelineDefaults,
  ReportSpec,
  ServiceContainer,
  EnvironmentSpec,
  EnvironmentAction,
  EnvironmentTier,
  ArtifactAccess,
  CacheSpec,
  CachePolicy,
  ConcurrencySpec,
} from "./graph.js";

export { synthesize } from "./synthesize.js";
export { validateGraph } from "./validate.js";
export { expandPipelineCalls } from "./expand-calls.js";
export { SynthesisError, type SynthesisErrorCode } from "./errors.js";

// ── Compat: old core API (used by sdk, ir, checks until rebuilt) ───
// These exports keep downstream packages working during the v0 redesign.
// Each wave that rebuilds a downstream package removes its dependency
// on these exports. They are removed when no longer needed.

export type {
  Operation,
  OperationKind,
  OperationSpec,
  CacheDeclaration,
  ArtifactDeclaration,
  NetworkPolicy,
  CredentialDeclaration,
} from "./operation.js";
export type {
  RuntimeMode,
  RuntimeResult,
  RuntimeFinalization,
  OperationOutcome,
  PlanContext,
  Artifact,
} from "./runtime.js";
export { pipeline } from "./composables/pipeline.js";
export { run } from "./composables/run.js";
export { parallel } from "./composables/parallel.js";
export { when } from "./composables/when.js";
export { matrix } from "./composables/matrix.js";
export { workflow, type Workflow } from "./composables/workflow.js";
export { CoreError, PlanningError, CompositionError } from "./errors.js";
export { computeOperationId } from "./internal/ids.js";
export { canonicalStringify } from "./internal/canonical.js";
