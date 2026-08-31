// Deterministic content-addressed IDs.
// ADR-006 (amended). Spec 06 — Data models.

import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical.js";
import type { DefinitionGraph } from "../core/index.js";
import type { RunPlan } from "./run-plan.js";

/**
 * Compute a deterministic graph id from the Definition Graph content.
 * SHA-256 over canonicalStringify(graph), hex-encoded, prefixed `graph-`.
 */
export function computeGraphId(graph: DefinitionGraph): string {
  const canonical = canonicalStringify(graph);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `graph-${hex}`;
}

/**
 * Compute a deterministic run plan id from the plan content (excluding
 * `id` and `createdAt`). SHA-256 over canonical JSON, prefixed `rp-`.
 */
export function computeRunPlanId(plan: Omit<RunPlan, "id" | "createdAt">): string {
  const canonical = canonicalStringify(plan);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `rp-${hex}`;
}
