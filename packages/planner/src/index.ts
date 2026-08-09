// @sverka/planner — public API

export { type Planner, type DiscoverOptions, type ProjectContext,
         type PlanProposal, type ProposedCheck, type LocalSignal,
         type LocalSignalType, type DetectedLanguage,
         type DetectedPackageManager, type MonorepoMarker,
         type ChangedFile, type DiscoveryExplanation } from "./planner.js";
export { createPlanner } from "./planner.js";
export { DiscoveryError, type DiscoveryErrorCode } from "./errors.js";
