/**
 * Canonical JSON serialization — the stable primitive shared by
 * `computeOperationId` (and, in the `ir` package, `serializePlan` /
 * `computePlanId`).
 *
 * Rules (per ADR-006 and spec 01-core §ID assignment):
 * - Object keys sorted lexicographically (ascending UTF-16 code-unit order,
 *   i.e. default JS string comparison).
 * - Compact: no whitespace, no indentation, no trailing newline.
 * - `undefined` object fields are omitted (never serialized).
 * - Array element order is preserved; `undefined` array elements emit `null`.
 * - `NaN`, `Infinity`, `-Infinity` are rejected (not valid JSON).
 * - Strings escaped per JSON.stringify rules.
 *
 * Implemented as a manual recursive emitter so the wire format and the hash
 * input can never drift. This is an independent copy of the `ir` package's
 * `internal/canonical.ts` (core must not depend on ir); both reference
 * ADR-006 as the source of truth and are kept in lockstep by the
 * core/ir consistency test.
 */
export function canonicalStringify(value: unknown): string {
  const out: string[] = [];
  emit(value, out);
  return out.join("");
}

function emit(value: unknown, out: string[]): void {
  if (value === null) {
    out.push("null");
    return;
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      emitArray(value, out);
    } else {
      emitObject(value as Record<string, unknown>, out);
    }
    return;
  }
  emitScalar(value, out);
}

function emitScalar(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(quoteString(value));
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new TypeError(
        `canonical JSON does not support ${String(value)} (NaN/Infinity are not valid JSON)`,
      );
    }
    out.push(Number(value).toString());
    return;
  }
  if (typeof value === "bigint") {
    throw new TypeError("canonical JSON does not support bigint");
  }
  throw new TypeError(
    `canonical JSON does not support value of type ${typeof value}`,
  );
}

function emitArray(value: unknown[], out: string[]): void {
  out.push("[");
  for (let i = 0; i < value.length; i++) {
    const el = value[i];
    if (el === undefined) {
      out.push("null");
    } else {
      emit(el, out);
    }
    if (i < value.length - 1) out.push(",");
  }
  out.push("]");
}

function emitObject(obj: Record<string, unknown>, out: string[]): void {
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    keys.push(k);
  }
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  out.push("{");
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    out.push(quoteString(k));
    out.push(":");
    emit(obj[k], out);
    if (i < keys.length - 1) out.push(",");
  }
  out.push("}");
}

/**
 * Quote a string per JSON rules. Mirrors JSON.stringify's string escaping:
 * escapes ", \\, and control chars (< 0x20) using short escapes where defined
 * and \u00XX otherwise.
 */
function quoteString(s: string): string {
  const parts: string[] = ['"'];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = ch.charCodeAt(0);
    switch (ch) {
      case '"':
        parts.push('\\"');
        break;
      case "\\":
        parts.push("\\\\");
        break;
      case "\b":
        parts.push("\\b");
        break;
      case "\t":
        parts.push("\\t");
        break;
      case "\n":
        parts.push("\\n");
        break;
      case "\f":
        parts.push("\\f");
        break;
      case "\r":
        parts.push("\\r");
        break;
      default:
        if (code < 0x20) {
          parts.push("\\u" + code.toString(16).padStart(4, "0"));
        } else {
          parts.push(ch);
        }
    }
  }
  parts.push('"');
  return parts.join("");
}
