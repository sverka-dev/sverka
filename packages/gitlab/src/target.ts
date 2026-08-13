// GitlabTarget — implements the Target contract (§19).
// Spec 09 — §18.2, §19.

import type { DefinitionGraph } from "@sverka/core";
import type { CapabilityManifest } from "@sverka/plugin";
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
export class GitlabTarget {
  readonly id = "gitlab";
  readonly capabilities: CapabilityManifest = gitlabCapabilities;

  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    const diags = analyzeCapabilities(graph, [this.capabilities]);
    return diags as readonly TargetDiagnostic[];
  }

  lower(graph: DefinitionGraph): GitlabTargetGraph {
    return lowerGitlab(graph);
  }

  emit(targetGraph: GitlabTargetGraph): readonly GeneratedArtifact[] {
    return emitGitlab(targetGraph);
  }
}

/**
 * Convenience function: analyze → lower → emit in one call.
 */
export function compileGitlab(graph: DefinitionGraph): CompilationResult {
  const target = new GitlabTarget();
  const diagnostics = target.analyze(graph);
  const targetGraph = target.lower(graph);
  const artifacts = target.emit(targetGraph);
  return { artifacts, diagnostics };
}
