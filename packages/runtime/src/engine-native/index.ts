// @sverka/engine-native — public API. Spec 10. Spec 29 (snapshot types).

export { createEngine } from "./engine.js";
export { createValueStore } from "./value-store.js";
export { createArtifactStore } from "./artifact-store.js";
export { createFileCacheStore } from "./cache-store.js";
export { createStubAgentDriver } from "./agent-driver.js";
export { createInMemorySnapshotStore } from "./snapshot-store.js";

export type {
  Engine, RunRequest, ResumeRequest, RunEvent, RunStatus, RuntimeDriver,
  ShellExecuteRequest, ShellResult, ValueStore, ArtifactStore,
  SecretProvider, EngineConfig,
  RunSnapshot, SnapshotStore, ResumeSchema,
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
