// DroneTarget — implements the Target contract (§19).
// Spec 36 — Drone/Gitness CI YAML target.

import type { DefinitionGraph } from "@sverka/workflow";
import type { CapabilityManifest, Target } from "../plugin/index.js";
import { analyzeCapabilities } from "../plugin/index.js";
import { droneCapabilities } from "./capabilities.js";
import { lowerDrone } from "./lower.js";
import { emitDrone } from "./emit.js";
import type {
  DroneTargetGraph,
  DroneTargetConfig,
  GeneratedArtifact,
  TargetDiagnostic,
  CompilationResult,
} from "./types.js";

/**
 * Drone CI target — native lowering from Definition Graph.
 * Implements the Target contract: analyze → lower → emit.
 */
export class DroneTarget implements Target {
  readonly name = "drone";
  readonly capabilities: CapabilityManifest = droneCapabilities;

  private readonly config: DroneTargetConfig;

  constructor(config?: DroneTargetConfig) {
    this.config = config ?? {};
  }

  /**
   * Analyze a Definition Graph against the Drone capability manifest.
   * Returns diagnostics for unsupported or emulated capabilities.
   */
  analyze(graph: DefinitionGraph): readonly TargetDiagnostic[] {
    return analyzeCapabilities(graph, [this.capabilities]) as readonly TargetDiagnostic[];
  }

  /**
   * Lower a Definition Graph to a DroneTargetGraph.
   * One Drone step per reachable Step with depends_on and operation mapping.
   */
  lower(graph: DefinitionGraph): DroneTargetGraph {
    return lowerDrone(graph, this.config);
  }

  /**
   * Emit a DroneTargetGraph as YAML artifacts.
   * Produces one .drone.yml file.
   */
  emit(targetGraph: DroneTargetGraph): readonly GeneratedArtifact[] {
    return emitDrone(targetGraph);
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
export function compileDrone(graph: DefinitionGraph, config?: DroneTargetConfig): CompilationResult {
  return new DroneTarget(config).compile(graph);
}
