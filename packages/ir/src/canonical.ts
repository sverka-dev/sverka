// Canonical JSON serialization — the stable primitive shared by
// serializeGraph/serializeRunPlan and computeGraphId/computeRunPlanId.
// ADR-006 (amended).
//
// Rules:
// - Object keys sorted lexicographically (ascending UTF-16 code-unit order).
// - Compact: no whitespace, no indentation, no trailing newline.
// - `undefined` object fields are omitted (never serialized).
// - Array element order is preserved; `undefined` array elements emit `null`.
// - `NaN`, `Infinity`, `-Infinity` are rejected (not valid JSON).
// - `Date` instances emit their ISO string.
// - Strings escaped per JSON.stringify rules.

export function canonicalStringify(value: unknown): string {
  const out: string[] = [];
  emit(value, out);
  return out.join("");
}

function emit(value: unknown, out: string[]): void {
  if (value === undefined) {
    out.push("null");
    return;
  }
  if (value === null) {
    out.push("null");
    return;
  }
  if (typeof value === "object") {
    if (value instanceof Date) {
      out.push(quoteString(value.toISOString()));
      return;
    }
    if (Array.isArray(value)) {
      emitArray(value, out);
      return;
    }
    emitObject(value as Record<string, unknown>, out);
    return;
  }
  if (typeof value === "string") {
    out.push(quoteString(value));
    return;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new TypeError("NaN and Infinity are not valid canonical JSON");
    }
    out.push(String(value));
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
    return;
  }
  // Fallback: stringify anything else (bigint, symbol, function).
  out.push(quoteString(String(value)));
}

function emitObject(obj: Record<string, unknown>, out: string[]): void {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  keys.sort();
  out.push("{");
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    if (i > 0) out.push(",");
    out.push(quoteString(key));
    out.push(":");
    emit(obj[key], out);
  }
  out.push("}");
}

function emitArray(arr: unknown[], out: string[]): void {
  out.push("[");
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) out.push(",");
    emit(arr[i], out);
  }
  out.push("]");
}

// JSON.stringify-compatible string quoting.
function quoteString(s: string): string {
  return JSON.stringify(s);
}
