import { createHash } from "node:crypto";
import { canonicalStringify } from "@sverka/core";
export { computeOperationId } from "@sverka/core";
import type { Plan } from "./plan.js";

/**
 * Compute a deterministic plan id from the plan content (excluding `id` and
 * `createdAt`). The same workflow + source context always yields the same id.
 *
 * Algorithm: SHA-256 over the canonical serialization of the plan with `id`
 * and `createdAt` stripped, hex-encoded, prefixed with `plan-`. The hash
 * input is byte-stable because canonical JSON sorts keys and emits no
 * trailing whitespace.
 */
export function computePlanId(plan: Omit<Plan, "id" | "createdAt">): string {
  // Defensive: strip any runtime id/createdAt fields so the hash is always
  // over the plan content, not the plan identity.
  const { id: _id, createdAt: _createdAt, ...body } = plan as Record<string, unknown>;
  const canonical = canonicalStringify(body);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `plan-${hex}`;
}

/**
 * Compute a deterministic operation id from kind, name, and a context record
 * (matrix values, position, or other discriminating fields).
 *
 * Re-exported from `@sverka/core` to ensure core and ir produce identical ids
 * by construction (ADR-006). The core/ir consistency test guards against drift.
 */
