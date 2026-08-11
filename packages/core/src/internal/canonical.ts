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
 * - Strings escaped per JSON.stringify rules, including lone UTF-16 surrogate
 *   code units.
 *
 * Implemented as a manual recursive emitter so the wire format and the hash
 * input can never drift. This is the single source of truth — the `ir` package
 * re-exports it from `@sverka/core` rather than maintaining its own copy.
 */
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
 * escapes ", \, and control chars (< 0x20) using short escapes where defined
 * and \u00XX otherwise. Lone UTF-16 surrogate code units (0xD800–0xDFFF not
 * part of a valid pair) are escaped as \uXXXX to ensure valid UTF-8 output.
 */
const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

function quoteString(s: string): string {
  const parts: string[] = ['"'];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const escaped = SHORT_ESCAPES[ch];
    if (escaped !== undefined) {
      parts.push(escaped);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20 || isLoneSurrogate(code, i, s)) {
      parts.push("\\u" + code.toString(16).padStart(4, "0"));
    } else {
      parts.push(ch);
    }
  }
  parts.push('"');
  return parts.join("");
}

/** Check if a UTF-16 code unit is a lone surrogate (not part of a valid pair). */
function isLoneSurrogate(code: number, i: number, s: string): boolean {
  if (code < 0xd800 || code > 0xdfff) return false;
  if (isLowSurrogate(code) && hasValidHighSurrogateBefore(i, s)) return false;
  if (isHighSurrogate(code) && hasValidLowSurrogateAfter(i, s)) return false;
  return true;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00;
}

function isHighSurrogate(code: number): boolean {
  return code <= 0xdbff;
}

function hasValidHighSurrogateBefore(i: number, s: string): boolean {
  if (i === 0) return false;
  const prev = s.charCodeAt(i - 1);
  return prev >= 0xd800 && prev <= 0xdbff;
}

function hasValidLowSurrogateAfter(i: number, s: string): boolean {
  if (i + 1 >= s.length) return false;
  const next = s.charCodeAt(i + 1);
  return next >= 0xdc00 && next <= 0xdfff;
}
