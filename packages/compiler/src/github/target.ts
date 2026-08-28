// GithubTarget — implements the Target contract (§19).
// Spec 08 — §18.1, §19.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
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
export class GithubTarget implements Target {
  readonly name = "github";
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
   * Lower a Definition Graph to one or more GithubTargetGraphs.
   * Single-pipeline graphs return one target graph; multi-pipeline graphs
   * with reusable workflow calls return one per pipeline.
   */
  lower(graph: DefinitionGraph): GithubTargetGraph | readonly GithubTargetGraph[] {
    return lowerGithub(graph);
  }

  /**
   * Emit one or more GithubTargetGraphs as YAML artifacts.
   * Produces .github/workflows/<name>.yml files.
   */
  emit(
    targetGraph: GithubTargetGraph | readonly GithubTargetGraph[],
  ): readonly GeneratedArtifact[] {
    return emitGithub(targetGraph);
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
export function compileGithub(graph: DefinitionGraph): CompilationResult {
  return new GithubTarget().compile(graph);
}
