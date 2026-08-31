// @sverka/compiler dagger sub-module — public API. Spec 34.

export { DaggerTarget, compileDagger } from "./target.js";
export { daggerCapabilities } from "./capabilities.js";
export type {
  DaggerTargetGraph,
  DaggerStep,
  DaggerTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";
export { DaggerTargetError, type DaggerTargetErrorCode } from "./errors.js";
