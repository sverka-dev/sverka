// GitlabTarget — implements the Target contract (§19).
// Spec 09 — §18.2, §19.

import type { DefinitionGraph } from "@sverka/core";
import type { CapabilityManifest, Target } from "@sverka/plugin";
import { analyzeCapabilities } from "@sverka/plugin";
import { gitlabCapabilities } from "./capabilities.js";
import { lowerGitlab } from "./lower.js";
import { emitGitlab } from "./emit.js";
import type {
  GitlabTargetGraph,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * GitLab CI target — native lowering from Definition Graph.
 * Implements the Target contract: analyze → lower → emit.
 */
export class GitlabTarget implements Target {
  readonly name = "gitlab";
  readonly capabilities: CapabilityManifest = gitlabCapabilities;

  /**
   * Analyze a Definition Graph against the GitLab capability manifest.
   * Returns diagnostics for unsupported or emulated capabilities.
   */
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    const diags = analyzeCapabilities(graph, [this.capabilities]);
    return diags as readonly TargetDiagnostic[];
  }

  /**
   * Lower a Definition Graph to a GitlabTargetGraph.
   * One GitLab job per reachable Step with needs, stages, and operation mapping.
   */
  lower(graph: DefinitionGraph): GitlabTargetGraph {
    return lowerGitlab(graph);
  }

  /**
   * Emit a GitlabTargetGraph as YAML artifacts.
   * Produces one .gitlab-ci.yml file.
   */
  emit(targetGraph: GitlabTargetGraph): readonly GeneratedArtifact[] {
    return emitGitlab(targetGraph);
  }

  /**
   * Compile a Definition Graph to generated artifacts and diagnostics.
   */
  compile(graph: DefinitionGraph): CompilationResult {
    const diagnostics = this.analyze(graph);
    const targetGraph = this.lower(graph);
    const artifacts = this.emit(targetGraph);
    return { artifacts, diagnostics };
  }
}

/**
 * Convenience function: analyze → lower → emit in one call.
 */
export function compileGitlab(graph: DefinitionGraph): CompilationResult {
  return new GitlabTarget().compile(graph);
}
