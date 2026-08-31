// DaggerTarget — implements the Target contract (§19).
// Spec 34 — Dagger Module code generation target.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
import { daggerCapabilities } from "./capabilities.js";
import { lowerDagger } from "./lower.js";
import { emitDagger } from "./emit.js";
import type {
  DaggerTargetGraph,
  DaggerTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * Dagger Module code generation target.
 * Implements the Target contract: analyze → lower → emit.
 */
export class DaggerTarget implements Target {
  readonly name = "dagger";
  readonly capabilities: CapabilityManifest = daggerCapabilities;

  private readonly config: DaggerTargetConfig;

  constructor(config?: DaggerTargetConfig) {
    this.config = config ?? {};
  }

  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    return analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
  }

  lower(graph: DefinitionGraph): DaggerTargetGraph {
    return lowerDagger(graph, this.config);
  }

  emit(targetGraph: DaggerTargetGraph): readonly GeneratedArtifact[] {
    return emitDagger(targetGraph);
  }

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
export function compileDagger(graph: DefinitionGraph, config?: DaggerTargetConfig): CompilationResult {
  return new DaggerTarget(config).compile(graph);
}
