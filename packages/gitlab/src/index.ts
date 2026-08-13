// @sverka/gitlab — public API. Spec 09.

export { GitlabTarget, compileGitlab } from "./target.js";
export { gitlabCapabilities } from "./capabilities.js";
export type {
  GitlabTargetGraph,
  GitlabJob,
  GitlabRule,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";
export { GitlabTargetError, type GitlabTargetErrorCode } from "./errors.js";
