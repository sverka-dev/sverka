import type { OperationSpec } from "../operation.js";

/** Concatenate string arrays and remove duplicates, preserving first-seen order. */
export function concatDedupe(arr: readonly string[]): string[] {
  return [...new Set(arr)];
}

/** Fields whose values are arrays that should be concatenated (not replaced). */
const CONCAT_FIELDS: ReadonlySet<keyof OperationSpec> = new Set<keyof OperationSpec>([
  "dependsOn",
  "tags",
]);

/** Allowlist of valid OperationSpec field names, used to reject prototype pollution. */
const SPEC_KEYS: ReadonlySet<string> = new Set<string>([
  "id", "kind", "name", "description", "command", "args", "env", "workingDir",
  "image", "imageDigest", "dependsOn", "condition", "matrix", "cpuLimit",
  "memoryLimit", "timeoutSeconds", "retries", "continueOnError", "cache",
  "artifacts", "network", "credentials", "tags",
]);

/**
 * Merge two partial specs. Scalar fields: `b` wins when defined. `dependsOn`
 * and `tags`: arrays concatenated and deduplicated. Nested objects (`cache`,
 * `credentials`, `artifacts`): `b` wins when defined (no deep merge for v1).
 *
 * Only keys in the {@link SPEC_KEYS} allowlist are copied from `b`; this
 * prevents prototype pollution via `__proto__` or `constructor` keys in
 * JSON-derived input.
 */
export function mergeSpecs(
  a: Readonly<Partial<OperationSpec>>,
  b: Readonly<Partial<OperationSpec>>,
): Partial<OperationSpec> {
  const result: Partial<OperationSpec> = { ...a };
  const target = result as Record<string, unknown>;
  for (const [key, value] of Object.entries(b)) {
    if (value === undefined) continue;
    if (!SPEC_KEYS.has(key)) continue;
    const field = key as keyof OperationSpec;
    if (CONCAT_FIELDS.has(field)) {
      const prev = target[key] as readonly string[] | undefined;
      const next = value as readonly string[];
      target[key] = concatDedupe([...(prev ?? []), ...next]);
    } else {
      target[key] = value;
    }
  }
  return result;
}
