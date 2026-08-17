import type { Reference, StepRef, ContextRef } from "@sverka/cdk";

/**
 * Type guard for Reference values.
 * Shared between expr.ts and sh.ts to avoid duplication.
 */
export function isReference(value: unknown): value is Reference {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const ref = value as { kind: string };
  if (ref.kind === "step") {
    const s = value as Partial<StepRef>;
    return typeof s.step === "string" && typeof s.output === "string" && typeof s.type === "string";
  }
  if (ref.kind === "context") {
    const c = value as Partial<ContextRef>;
    return typeof c.namespace === "string" && typeof c.field === "string";
  }
  return false;
}
