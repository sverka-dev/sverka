// InngestTarget — implements the Target contract (§19).
// Spec 35 — Inngest function code generation target.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
import { inngestCapabilities } from "./capabilities.js";
import { lowerInngest } from "./lower.js";
import { emitInngest } from "./emit.js";
import type {
  InngestTargetGraph,
  InngestTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * Inngest function code generation target.
 * Implements the Target contract: analyze → lower → emit.
 */
export class InngestTarget implements Target {
  readonly name = "inngest";
  readonly capabilities: CapabilityManifest = inngestCapabilities;

  private readonly config: InngestTargetConfig;

  constructor(config?: InngestTargetConfig) {
    this.config = config ?? {};
  }

  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    return analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
  }

  lower(graph: DefinitionGraph): InngestTargetGraph {
    return lowerInngest(graph, this.config);
  }

  emit(targetGraph: InngestTargetGraph): readonly GeneratedArtifact[] {
    return emitInngest(targetGraph);
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
export function compileInngest(graph: DefinitionGraph, config?: InngestTargetConfig): CompilationResult {
  return new InngestTarget(config).compile(graph);
}
