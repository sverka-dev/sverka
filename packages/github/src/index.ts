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
} from "./types.js";
export { GithubTargetError, type GithubTargetErrorCode } from "./errors.js";
