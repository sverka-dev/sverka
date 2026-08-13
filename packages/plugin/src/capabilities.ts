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
import { PluginError } from "./errors.js";

const SUPPORT_LEVELS: readonly CapabilitySupport[] = [
  "native",
  "lowered",
  "emulated",
  "connector",
  "partial",
  "unsupported",
];

const PRIORITY: Record<CapabilitySupport, number> = {
  native: 6,
  lowered: 5,
  connector: 4,
  emulated: 3,
  partial: 2,
  unsupported: 1,
};

/**
 * Validate that a value is a valid capability support level.
 */
export function validateSupport(value: unknown): CapabilitySupport {
  if (typeof value !== "string" || !SUPPORT_LEVELS.includes(value as CapabilitySupport)) {
    throw new PluginError(
      `invalid capability support level: ${String(value)}`,
      "INVALID_CAPABILITY",
    );
  }
  return value as CapabilitySupport;
}

/**
 * Validate a capability manifest object.
 */
export function validateCapabilityManifest(manifest: unknown): asserts manifest is CapabilityManifest {
  if (typeof manifest !== "object" || manifest === null) {
    throw new PluginError("capability manifest must be an object", "INVALID_CAPABILITY");
  }
  const obj = manifest as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      validateSupport(value);
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const detail = value as Record<string, unknown>;
      const support = validateSupport(detail.support);
      if (detail.via !== undefined && typeof detail.via !== "string") {
        throw new PluginError(
          `capability '${key}' has invalid via: must be a string`,
          "INVALID_CAPABILITY",
        );
      }
      if (detail.notes !== undefined && typeof detail.notes !== "string") {
        throw new PluginError(
          `capability '${key}' has invalid notes: must be a string`,
          "INVALID_CAPABILITY",
        );
      }
      // Re-assign normalized support if needed.
      void support;
      continue;
    }
    throw new PluginError(
      `capability '${key}' must be a support string or CapabilityDetail object`,
      "INVALID_CAPABILITY",
    );
  }
}

/**
 * Detect capabilities used by a single step.
 */
function detectStepCapabilities(step: {
  runtime?: { mode?: string };
  operations: readonly { kind: string }[];
  outputs: readonly { type: string }[];
  dependencies: readonly unknown[];
}, caps: Set<string>): void {
  const mode = step.runtime?.mode ?? "host";
  caps.add(`runtime.${mode}`);

  let hasScalarOutput = false;
  let hasArtifactOutput = false;

  for (const op of step.operations) {
    switch (op.kind) {
      case "shell":
        caps.add("operation.shell");
        break;
      case "exportOutput":
        hasScalarOutput = true;
        break;
      case "exportArtifact":
        hasArtifactOutput = true;
        break;
      case "importArtifact":
        caps.add("operation.import");
        break;
    }
  }

  for (const output of step.outputs) {
    if (output.type === "artifact") {
      hasArtifactOutput = true;
    } else {
      hasScalarOutput = true;
    }
  }

  if (step.dependencies.length > 0) {
    caps.add("graph.dependencies");
  }
  if (hasScalarOutput) caps.add("output.scalar");
  if (hasArtifactOutput) caps.add("output.artifact");
}

/**
 * Detect capabilities used by a single pipeline.
 */
function detectPipelineCapabilities(pipeline: {
  entries: readonly { trigger: { kind: string } }[];
  steps: readonly {
    runtime?: { mode?: string };
    operations: readonly { kind: string }[];
    outputs: readonly { type: string }[];
    dependencies: readonly unknown[];
  }[];
}, caps: Set<string>): void {
  for (const entry of pipeline.entries) {
    caps.add(`trigger.${entry.trigger.kind}`);
  }
  for (const step of pipeline.steps) {
    detectStepCapabilities(step, caps);
  }
}

/**
 * Detect capabilities used by a Definition Graph.
 * Returns a set of capability identifiers (e.g., "trigger.push").
 */
export function detectCapabilities(graph: DefinitionGraph): Set<string> {
  const caps = new Set<string>();
  for (const pipeline of graph.project.pipelines) {
    detectPipelineCapabilities(pipeline, caps);
  }
  return caps;
}

/**
 * Get the support level from a manifest entry.
 */
function getSupportLevel(entry: CapabilitySupport | CapabilityDetail): CapabilitySupport {
  if (typeof entry === "string") return validateSupport(entry);
  if (entry === null || typeof entry !== "object") {
    throw new PluginError("capability entry must be a string or CapabilityDetail", "INVALID_CAPABILITY");
  }
  return validateSupport((entry as CapabilityDetail).support);
}

/**
 * Find the best support level for a capability across all manifests.
 * "native" > "lowered" > "connector" > "emulated" > "partial" > "unsupported".
 */
function findBestSupport(
  capability: string,
  manifests: readonly CapabilityManifest[],
): CapabilitySupport {
  let best: CapabilitySupport = "unsupported";
  for (const manifest of manifests) {
    const entry = manifest[capability];
    if (entry === undefined) continue;
    const level = getSupportLevel(entry);
    if (PRIORITY[level] > PRIORITY[best]) {
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
  for (const manifest of manifests) {
    validateCapabilityManifest(manifest);
  }
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
