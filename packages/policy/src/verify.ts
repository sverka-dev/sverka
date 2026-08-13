// Policy verification against a Definition Graph.
// Spec 16 — §26, §27. Verifies that policy checkIds reference check
// steps that exist in the graph.

import type { DefinitionGraph } from "@sverka/core";
import type { Policy } from "./types.js";

export interface PolicyVerification {
  readonly valid: boolean;
  readonly unknownCheckIds: readonly string[];
  readonly errors?: readonly string[];
}

/** Strip the `checks/` prefix so `checks/typecheck` and `typecheck` compare equal. */
function normalizeCheckId(id: string): string {
  return id.startsWith("checks/") ? id.slice(7) : id;
}

/**
 * Verify that all checkIds referenced in a policy's failOn rules exist
 * as check step IDs in the Definition Graph. A step is treated as a check
 * when its ID starts with `checks/`. Returns a PolicyVerification
 * with valid=false and the list of unknown check IDs if any are found.
 *
 * Does not throw for structural errors — returns them in `errors`.
 */
export function verifyPolicyAgainstGraph(
  policy: Policy,
  graph: DefinitionGraph,
): PolicyVerification {
  const errors: string[] = [];

  if (!policy || typeof policy !== "object") {
    errors.push("invalid policy: expected object");
  } else if (!Array.isArray(policy.failOn)) {
    errors.push("invalid policy: failOn must be an array");
  }

  if (!graph || typeof graph !== "object" || !Array.isArray(graph.project?.pipelines)) {
    errors.push("invalid graph: project.pipelines must be an array");
  }

  if (errors.length > 0) {
    return { valid: false, unknownCheckIds: [], errors };
  }

  // Collect check IDs from check steps across all pipelines.
  const knownCheckIds = new Set<string>();
  for (const pipeline of graph.project.pipelines) {
    if (!Array.isArray(pipeline.steps)) continue;
    for (const step of pipeline.steps) {
      if (typeof step.id === "string" && step.id.startsWith("checks/")) {
        knownCheckIds.add(normalizeCheckId(step.id));
      }
    }
  }

  // Collect all checkIds referenced in failOn rules.
  const referencedCheckIds = new Set<string>();
  for (const rule of policy.failOn) {
    const raw = (rule as { checkIds?: unknown }).checkIds;
    if (raw === undefined || raw === null) continue;
    const ids: string[] = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
    for (const id of ids) {
      if (typeof id === "string") referencedCheckIds.add(id);
    }
  }

  // Find unknown check IDs.
  const unknownCheckIds: string[] = [];
  for (const id of referencedCheckIds) {
    if (!knownCheckIds.has(normalizeCheckId(id))) {
      unknownCheckIds.push(id);
    }
  }

  return {
    valid: unknownCheckIds.length === 0,
    unknownCheckIds,
  };
}
