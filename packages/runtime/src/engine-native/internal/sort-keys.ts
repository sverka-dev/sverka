/**
 * Recursively sort object keys alphabetically for deterministic serialization.
 * Arrays are preserved as-is (order matters); primitives pass through unchanged.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === "object" && value !== null) {
    const src = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort((a, b) => a.localeCompare(b))) {
      result[key] = sortKeysDeep(src[key]);
    }
    return result;
  }
  return value;
}
