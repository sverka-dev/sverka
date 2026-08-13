// GithubTarget — implements the Target contract (§19).
// Spec 08 — §18.1, §19.

import type { DefinitionGraph } from "@sverka/core";
import type { CapabilityManifest } from "@sverka/plugin";
import { analyzeCapabilities } from "@sverka/plugin";
import { githubCapabilities } from "./capabilities.js";
import { lowerGithub } from "./lower.js";
import { emitGithub } from "./emit.js";
import type {
  GithubTargetGraph,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * GitHub Actions target — native lowering from Definition Graph.
 * Implements the Target contract: analyze → lower → emit.
 */
export class GithubTarget {
  readonly id = "github";
  readonly capabilities: CapabilityManifest = githubCapabilities;

  /**
   * Analyze a Definition Graph against the GitHub capability manifest.
   * Returns diagnostics for unsupported or emulated capabilities.
   */
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    const diags = analyzeCapabilities(graph, [this.capabilities]);
    return diags as readonly TargetDiagnostic[];
  }

  /**
   * Lower a Definition Graph to a GithubTargetGraph.
   * One GitHub job per Step with needs, runs-on, and operation mapping.
   */
  lower(graph: DefinitionGraph): GithubTargetGraph {
    return lowerGithub(graph);
  }

  /**
   * Emit a GithubTargetGraph as YAML artifacts.
   * Produces .github/workflows/<name>.yml files.
   */
  emit(targetGraph: GithubTargetGraph): readonly GeneratedArtifact[] {
    return emitGithub(targetGraph);
  }
}

/**
 * Convenience function: analyze → lower → emit in one call.
 */
export function compileGithub(graph: DefinitionGraph): CompilationResult {
  const target = new GithubTarget();
  const diagnostics = target.analyze(graph);
  const targetGraph = target.lower(graph);
  const artifacts = target.emit(targetGraph);
  return { artifacts, diagnostics };
}
