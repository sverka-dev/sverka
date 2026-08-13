// Policy verification against a Definition Graph.
// Spec 16 — §26, §27. Verifies that policy checkIds reference steps
// that exist in the graph.

import type { DefinitionGraph } from "@sverka/core";
import type { Policy } from "./types.js";

export interface PolicyVerification {
  readonly valid: boolean;
  readonly unknownCheckIds: readonly string[];
}

/**
 * Verify that all checkIds referenced in a policy's failOn rules exist
 * as step IDs in the Definition Graph. Returns a PolicyVerification
 * with valid=false and the list of unknown check IDs if any are found.
 *
 * Does not throw — returns a result object.
 */
export function verifyPolicyAgainstGraph(
  policy: Policy,
  graph: DefinitionGraph,
): PolicyVerification {
  // Collect all step IDs from all pipelines.
  const stepIds = new Set<string>();
  for (const pipeline of graph.project.pipelines) {
    for (const step of pipeline.steps) {
      stepIds.add(step.id);
    }
  }

  // Collect all checkIds referenced in failOn rules.
  const referencedCheckIds = new Set<string>();
  for (const rule of policy.failOn) {
    if (rule.checkIds === undefined) continue;
    for (const id of rule.checkIds) {
      referencedCheckIds.add(id);
    }
  }

  // Find unknown check IDs.
  const unknownCheckIds: string[] = [];
  for (const id of referencedCheckIds) {
    if (!stepIds.has(id)) {
      unknownCheckIds.push(id);
    }
  }

  return {
    valid: unknownCheckIds.length === 0,
    unknownCheckIds,
  };
}
