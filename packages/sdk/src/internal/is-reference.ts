import type { Reference, StepRef, ContextRef } from "@sverka/cdk";

const OUTPUT_TYPES = new Set<string>(["string", "number", "boolean", "artifact"]);
const CONTEXT_NAMESPACES = new Set<string>([
  "env", "secrets", "git", "change", "event", "run", "inputs", "matrix",
]);

/**
 * Type guard for Reference values.
 * Shared between expr.ts and sh.ts to avoid duplication.
 * Validates that type and namespace values are within their finite unions.
 */
export function isReference(value: unknown): value is Reference {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const ref = value as { kind: string };
  if (ref.kind === "step") return isStepRef(value);
  if (ref.kind === "context") return isContextRef(value);
  return false;
}

function isStepRef(value: object): boolean {
  const s = value as Partial<StepRef>;
  return (
    typeof s.step === "string" &&
    typeof s.output === "string" &&
    typeof s.type === "string" &&
    OUTPUT_TYPES.has(s.type)
  );
}

function isContextRef(value: object): boolean {
  const c = value as Partial<ContextRef>;
  return (
    typeof c.namespace === "string" &&
    typeof c.field === "string" &&
    CONTEXT_NAMESPACES.has(c.namespace)
  );
}
