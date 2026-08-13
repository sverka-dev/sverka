// @sverka/planner — public API. Spec 13.

export { type Planner, type DiscoverOptions, type ProjectContext,
         type PlanProposal, type ProposedCheck, type LocalSignal,
         type LocalSignalType, type DetectedLanguage,
         type DetectedPackageManager, type MonorepoMarker,
         type ChangedFile, type DiscoveryExplanation } from "./planner.js";
export { createPlanner } from "./planner.js";
export { DiscoveryError, type DiscoveryErrorCode } from "./errors.js";

// Run Plan binding (Wave G).
export { bindRunPlan, computeReachableSteps } from "./bind.js";
export type { BindRunPlanOptions } from "./bind.js";
export { PlannerError, type PlannerErrorCode } from "./errors.js";
