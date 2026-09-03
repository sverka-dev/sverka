// TemporalTarget — implements the Target contract (§19).
// Spec 33 — Temporal code generation target.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
import { temporalCapabilities } from "./capabilities.js";
import { lowerTemporal } from "./lower.js";
import { emitTemporal } from "./emit.js";
import type {
  TemporalTargetGraph,
  TemporalTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * Temporal code generation target.
 * Implements the Target contract: analyze → lower → emit.
 */
export class TemporalTarget implements Target {
  readonly name = "temporal";
  readonly capabilities: CapabilityManifest = temporalCapabilities;

  private readonly config: TemporalTargetConfig;

  constructor(config?: TemporalTargetConfig) {
    this.config = config ?? {};
  }

  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    return analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
  }

  lower(graph: DefinitionGraph): TemporalTargetGraph {
    return lowerTemporal(graph, this.config);
  }

  emit(targetGraph: TemporalTargetGraph): readonly GeneratedArtifact[] {
    return emitTemporal(targetGraph);
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
export function compileTemporal(graph: DefinitionGraph, config?: TemporalTargetConfig): CompilationResult {
  return new TemporalTarget(config).compile(graph);
}
