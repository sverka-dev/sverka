// Policy verification against a Definition Graph.
// Spec 16 — §26, §27. Verifies that policy checkIds reference check
// steps that exist in the graph.

import type { DefinitionGraph } from "@sverka/workflow";
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
  const errors = collectValidationErrors(policy, graph);
  if (errors.length > 0) {
    return { valid: false, unknownCheckIds: [], errors };
  }

  const knownCheckIds = collectKnownCheckIds(graph);
  const referencedCheckIds = collectReferencedCheckIds(policy);
  const unknownCheckIds = findUnknownCheckIds(referencedCheckIds, knownCheckIds);

  return {
    valid: unknownCheckIds.length === 0,
    unknownCheckIds,
  };
}

function collectValidationErrors(policy: Policy, graph: DefinitionGraph): string[] {
  const errors: string[] = [];
  if (!policy || typeof policy !== "object") {
    errors.push("invalid policy: expected object");
  } else if (!Array.isArray(policy.failOn)) {
    errors.push("invalid policy: failOn must be an array");
  }
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.project?.pipelines)) {
    errors.push("invalid graph: project.pipelines must be an array");
  }
  return errors;
}

function collectKnownCheckIds(graph: DefinitionGraph): Set<string> {
  const knownCheckIds = new Set<string>();
  for (const pipeline of graph.project.pipelines) {
    if (!Array.isArray(pipeline.steps)) continue;
    for (const step of pipeline.steps) {
      if (typeof step.id === "string" && step.id.startsWith("checks/")) {
        knownCheckIds.add(normalizeCheckId(step.id));
      }
    }
  }
  return knownCheckIds;
}

function collectReferencedCheckIds(policy: Policy): Set<string> {
  const referencedCheckIds = new Set<string>();
  for (const rule of policy.failOn) {
    const raw = (rule as { checkIds?: unknown }).checkIds;
    if (raw === undefined || raw === null) continue;
    const ids: string[] = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
    for (const id of ids) {
      if (typeof id === "string") referencedCheckIds.add(id);
    }
  }
  return referencedCheckIds;
}

function findUnknownCheckIds(referenced: Set<string>, known: Set<string>): string[] {
  const unknown: string[] = [];
  for (const id of referenced) {
    if (!known.has(normalizeCheckId(id))) {
      unknown.push(id);
    }
  }
  return unknown;
}
