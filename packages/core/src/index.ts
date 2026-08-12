// Public exports for @sverka/core. Spec 02, 05.

export type {
  DefinitionGraph,
  ProjectDefinition,
  PipelineDefinition,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
} from "./graph.js";

export { synthesize } from "./synthesize.js";
export { SynthesisError, type SynthesisErrorCode } from "./errors.js";
