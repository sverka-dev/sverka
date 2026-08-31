// @sverka/github — public API. Spec 08.

export { GithubTarget, compileGithub } from "./target.js";
export { githubCapabilities } from "./capabilities.js";
export type {
  GithubTargetGraph,
  GithubTriggers,
  GithubJob,
  GithubStep,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
  GithubTargetConfig,
} from "./types.js";
export { GithubTargetError, type GithubTargetErrorCode } from "./errors.js";

// F-43: Importer
export { importGithub, importGithubWithDiagnostics } from "./importer.js";
export type { ImportDiagnostic, ImportResult } from "./importer.js";

// Spec 22: GHA action SHA pinning.
export { pinActionRef, loadBundledRegistry } from "./pinning.js";
export type { PinRegistry, PinningConfig } from "./pinning.js";
