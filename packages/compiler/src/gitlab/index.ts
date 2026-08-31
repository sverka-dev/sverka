// @sverka/gitlab — public API. Spec 09.

export { GitlabTarget, compileGitlab } from "./target.js";
export { gitlabCapabilities } from "./capabilities.js";
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
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";
export { GitlabTargetError, type GitlabTargetErrorCode } from "./errors.js";

// F-43: Importer
export { importGitlab, importGitlabWithDiagnostics } from "./importer.js";
export type { ImportDiagnostic, ImportResult } from "./importer.js";
