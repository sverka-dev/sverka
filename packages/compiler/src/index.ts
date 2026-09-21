// @sverka/compiler — public barrel

export * from "./plugin/index.js";

// Native target compilers (Definition Graph → CI YAML).
export { compileGithub } from "./github/target.js";
export { compileGitlab } from "./gitlab/target.js";
export type {
  CompilationResult,
  GeneratedArtifact,
  TargetDiagnostic,
  GithubTargetConfig,
  GithubStep,
} from "./github/types.js";

// Spec 22: GHA action SHA pinning (re-exported from the native github target).
export { pinActionRef, loadBundledRegistry } from "./github/pinning.js";
export type { PinRegistry, PinningConfig } from "./github/pinning.js";
