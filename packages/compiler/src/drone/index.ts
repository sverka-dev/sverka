// @sverka/compiler drone sub-module — public API. Spec 36.

export { DroneTarget, compileDrone } from "./target.js";
export { droneCapabilities } from "./capabilities.js";
export type {
  DroneTargetGraph,
  DroneStep,
  DroneTrigger,
  DroneTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";
export { DroneTargetError, type DroneTargetErrorCode } from "./errors.js";
