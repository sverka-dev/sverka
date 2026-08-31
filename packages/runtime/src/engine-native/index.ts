// @sverka/engine-native — public API. Spec 10.

export { createEngine } from "./engine.js";
export { createValueStore } from "./value-store.js";
export { createArtifactStore } from "./artifact-store.js";
export { createFileCacheStore } from "./cache-store.js";
export { createStubAgentDriver } from "./agent-driver.js";

export type {
  Engine, RunRequest, RunEvent, RunStatus, RuntimeDriver,
  ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore,
  SecretProvider, EngineConfig,
} from "./types.js";
export type {
  CacheStore,
  CacheRestoreRequest,
  CacheRestoreResult,
  CacheStoreRequest,
  FileCacheStoreConfig,
} from "./cache-store.js";
export type {
  AgentDriver,
  AgentExecuteRequest,
  AgentResult,
  AgentToolCall,
  AgentUsage,
} from "./agent-driver.js";

export { EngineError, SchedulerError, StepExecError, AgentDriverError } from "./errors.js";
export type { EngineErrorCode, AgentDriverErrorCode } from "./errors.js";

export { buildStepExecutionGraph, topoSortSteps, transitiveDependents, isStepReady } from "./scheduler.js";
export type { StepState, StepGraph } from "./scheduler.js";
