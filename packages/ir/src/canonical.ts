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
// - `bigint`, `symbol`, and `function` values are rejected (not JSON serializable).
// - Strings escaped per JSON.stringify rules.

import { SerializationError } from "./errors.js";

export function canonicalStringify(value: unknown): string {
  const out: string[] = [];
  emit(value, out);
  return out.join("");
}

function emit(value: unknown, out: string[]): void {
  if (value === undefined || value === null) {
    out.push("null");
    return;
  }
  const tp = typeof value;
  if (tp === "string") { out.push(quoteString(value)); return; }
  if (tp === "number") { emitNumber(value, out); return; }
  if (tp === "boolean") { out.push(value ? "true" : "false"); return; }
  if (tp === "object") { emitObjectLike(value, out); return; }
  throw new SerializationError(`Unsupported canonical JSON value: ${tp}`);
}

function emitNumber(value: number, out: string[]): void {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new SerializationError("NaN and Infinity are not valid canonical JSON");
  }
  out.push(String(value));
}

function emitObjectLike(value: object, out: string[]): void {
  if (value instanceof Date) {
    out.push(quoteString(value.toISOString()));
    return;
  }
  if (Array.isArray(value)) {
    emitArray(value, out);
    return;
  }
  emitObject(value as Record<string, unknown>, out);
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
