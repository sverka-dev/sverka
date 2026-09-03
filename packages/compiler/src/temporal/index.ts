// @sverka/compiler temporal sub-module — public API. Spec 33.

export { TemporalTarget, compileTemporal } from "./target.js";
export { temporalCapabilities } from "./capabilities.js";
export type {
  TemporalTargetGraph,
  TemporalWorkflow,
  TemporalActivity,
  TemporalTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";
export { TemporalTargetError, type TemporalTargetErrorCode } from "./errors.js";
