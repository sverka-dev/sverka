// Capability analysis. Spec 07 — §24.
// Inspects a Definition Graph to detect used capabilities, then checks
// against provided manifests to produce diagnostics.

import type { DefinitionGraph } from "@sverka/core";
import type {
  CapabilityManifest,
  CapabilitySupport,
  CapabilityDetail,
  CapabilityDiagnostic,
} from "./types.js";

/**
 * Detect capabilities used by a Definition Graph.
 * Returns a set of capability identifiers (e.g., "trigger.push").
 */
export function detectCapabilities(graph: DefinitionGraph): Set<string> {
  const caps = new Set<string>();

  for (const pipeline of graph.project.pipelines) {
    // Triggers from entries
    for (const entry of pipeline.entries) {
      caps.add(`trigger.${entry.trigger.kind}`);
    }

    // Runtime, operations, outputs, dependencies from steps
    let hasDeps = false;
    let hasScalarOutput = false;
    let hasArtifactOutput = false;

    for (const step of pipeline.steps) {
      // Runtime mode
      const mode = step.runtime.mode ?? "host";
      caps.add(`runtime.${mode}`);

      // Operations
      for (const op of step.operations) {
        if (op.kind === "shell") {
          caps.add("operation.shell");
        }
      }

      // Outputs
      for (const output of step.outputs) {
        if (output.type === "artifact") {
          hasArtifactOutput = true;
        } else {
          hasScalarOutput = true;
        }
      }

      // Dependencies
      if (step.dependencies.length > 0) {
        hasDeps = true;
      }
    }

    if (hasDeps) caps.add("graph.dependencies");
    if (hasScalarOutput) caps.add("output.scalar");
    if (hasArtifactOutput) caps.add("output.artifact");
  }

  return caps;
}

/**
 * Get the support level from a manifest entry.
 */
function getSupportLevel(entry: CapabilitySupport | CapabilityDetail): CapabilitySupport {
  if (typeof entry === "string") return entry;
  return entry.support;
}

/**
 * Find the best support level for a capability across all manifests.
 * "native" > "lowered" > "connector" > "emulated" > "partial" > "unsupported".
 */
function findBestSupport(
  capability: string,
  manifests: readonly CapabilityManifest[],
): CapabilitySupport {
  const priority: Record<CapabilitySupport, number> = {
    native: 6,
    lowered: 5,
    connector: 4,
    emulated: 3,
    partial: 2,
    unsupported: 1,
  };

  let best: CapabilitySupport = "unsupported";
  for (const manifest of manifests) {
    const entry = manifest[capability];
    if (entry === undefined) continue;
    const level = getSupportLevel(entry);
    if (priority[level] > priority[best]) {
      best = level;
    }
  }
  return best;
}

/**
 * Map a support level to a diagnostic severity.
 */
function severityFor(support: CapabilitySupport): "error" | "warning" | "info" {
  switch (support) {
    case "unsupported":
      return "error";
    case "emulated":
    case "partial":
      return "warning";
    case "connector":
      return "info";
    default:
      return "info";
  }
}

/**
 * Analyze a Definition Graph against capability manifests.
 * Returns diagnostics for capabilities that are not natively or lowered
 * supported.
 */
export function analyzeCapabilities(
  graph: DefinitionGraph,
  manifests: readonly CapabilityManifest[],
): readonly CapabilityDiagnostic[] {
  const used = detectCapabilities(graph);
  const diagnostics: CapabilityDiagnostic[] = [];

  for (const capability of used) {
    const support = findBestSupport(capability, manifests);
    if (support === "native" || support === "lowered") continue;

    diagnostics.push({
      capability,
      support,
      severity: severityFor(support),
      message: `capability '${capability}' is ${support}`,
    });
  }

  return diagnostics;
}
