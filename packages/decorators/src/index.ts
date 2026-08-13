// @sverka/decorators — public API. Spec 04.

export { pipeline, step, stepWithOptions, entry, input } from "./decorators.js";
export { decoratePipeline } from "./synthesize.js";
export type { StepOptions, EntryTarget, FieldMetadata, FieldKind, PlanningContext } from "./types.js";
export { DecoratorError, type DecoratorErrorCode } from "./errors.js";
