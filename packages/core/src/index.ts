// Public exports for @sverka/core. Spec 02, 05.

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
} from "./graph.js";

export { synthesize } from "./synthesize.js";
export { validateGraph } from "./validate.js";
export { SynthesisError, type SynthesisErrorCode } from "./errors.js";
