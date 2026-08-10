/**
 * Canonical JSON serialization for content-addressed ID computation
 * (ADR-006).
 *
 * Rules:
 * - Object keys sorted lexicographically.
 * - Compact output (no indentation, no spaces).
 * - `undefined` values omitted from objects and arrays.
 * - Array order preserved.
 * - `NaN`/`Infinity` serialized as `null` (JSON compatibility).
 * - No external dependency; the `ir` package implements the same
 *   algorithm independently for `serializePlan`.
 */

/**
 * Produce a canonical JSON string for the given value.
 * Keys are sorted lexicographically, `undefined` is omitted, and
 * output is compact.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Recursively canonicalize a value so that JSON.stringify produces
 * sorted-key, compact output with `undefined` omitted.
 */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(canonicalize).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    return canonicalizeObject(value as Record<string, unknown>);
  }
  return undefined;
}

/** Canonicalize an object: sort keys, omit undefined values. */
function canonicalizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const canonicalized = canonicalize(obj[key]);
    if (canonicalized !== undefined) {
      result[key] = canonicalized;
    }
  }
  return result;
}
