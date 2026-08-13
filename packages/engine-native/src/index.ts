// @sverka/engine-native — public API. Spec 10.

export { createEngine } from "./engine.js";
export { createValueStore } from "./value-store.js";
export { createArtifactStore } from "./artifact-store.js";

export type {
  Engine, RunRequest, RunEvent, RunStatus, RuntimeDriver,
  ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore,
  SecretProvider, EngineConfig,
} from "./types.js";

export { EngineError, SchedulerError, StepExecError } from "./errors.js";
export type { EngineErrorCode } from "./errors.js";

export { topoSortSteps, transitiveDependents, isStepReady } from "./scheduler.js";
export type { StepState } from "./scheduler.js";
