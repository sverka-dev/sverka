// @sverka/compiler — public barrel

export * from "./compiler-github/index.js";
export * from "./compiler-gitlab/index.js";
export * from "./plugin/index.js";

// Native target compilers (v0 architecture — Definition Graph → CI YAML).
export { compileGithub } from "./github/target.js";
export { compileGitlab } from "./gitlab/target.js";
export type {
  CompilationResult,
  GeneratedArtifact,
  TargetDiagnostic,
} from "./github/types.js";

// Spec 22: GHA action SHA pinning (re-exported from the native github target).
export { pinActionRef, loadBundledRegistry } from "./github/pinning.js";
export type { PinRegistry, PinningConfig } from "./github/pinning.js";

// v1 Wave 4: Code generation targets (ADR-016).
export { compileTemporal, TemporalTarget, temporalCapabilities, TemporalTargetError } from "./temporal/index.js";
export type { TemporalTargetConfig, TemporalTargetGraph, TemporalWorkflow, TemporalActivity, TemporalTargetErrorCode } from "./temporal/index.js";

export { compileDagger, DaggerTarget, daggerCapabilities, DaggerTargetError } from "./dagger/index.js";
export type { DaggerTargetConfig, DaggerTargetGraph, DaggerStep, DaggerTargetErrorCode } from "./dagger/index.js";

export { compileInngest, InngestTarget, inngestCapabilities, InngestTargetError } from "./inngest/index.js";
export type { InngestTargetConfig, InngestTargetGraph, InngestFunction, InngestStep, InngestTargetErrorCode } from "./inngest/index.js";

export { compileDrone, DroneTarget, droneCapabilities, DroneTargetError } from "./drone/index.js";
export type { DroneTargetConfig, DroneTargetGraph, DroneStep, DroneTrigger, DroneTargetErrorCode } from "./drone/index.js";
