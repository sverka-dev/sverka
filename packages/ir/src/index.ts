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
