// @sverka/compiler — public barrel

export * from "./plugin/index.js";

// Native target compilers (Definition Graph → CI YAML).
export { GithubTarget, compileGithub } from "./github/target.js";
export { githubCapabilities } from "./github/capabilities.js";
export { GithubTargetError, type GithubTargetErrorCode } from "./github/errors.js";
export type {
  GithubTargetGraph,
  GithubTriggers,
  GithubJob,
  GithubStep,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
  GithubTargetConfig,
} from "./github/types.js";

export { GitlabTarget, compileGitlab } from "./gitlab/target.js";
export { gitlabCapabilities } from "./gitlab/capabilities.js";
export { GitlabTargetError, type GitlabTargetErrorCode } from "./gitlab/errors.js";
export type {
  GitlabTargetGraph,
  GitlabJob,
  GitlabRule,
  GitlabArtifactSpec,
  GitlabComponentInclude,
  GitlabLocalInclude,
  GitlabTrigger,
  GitlabTriggerInclude,
  GitlabRelease,
  GitlabPages,
  GitlabWorkflowRule,
} from "./gitlab/types.js";

// F-43: Importers (CI YAML → Definition Graph, lossy with diagnostics).
// ImportDiagnostic/ImportResult are structurally identical per target —
// the canonical type names come from the github importer.
export { importGithub, importGithubWithDiagnostics } from "./github/importer.js";
export { importGitlab, importGitlabWithDiagnostics } from "./gitlab/importer.js";
export type { ImportDiagnostic, ImportResult } from "./github/importer.js";

// Spec 22: GHA action SHA pinning (re-exported from the native github target).
export { pinActionRef, loadBundledRegistry } from "./github/pinning.js";
export type { PinRegistry, PinningConfig } from "./github/pinning.js";
