/**
 * Canonical JSON serialization — the single stable primitive shared by
 * `serializePlan` and `computePlanId`.
 *
 * Rules (per spec §Serialization):
 * - UTF-8 encoded output, but key comparison is byte-wise on UTF-16 code
 *   units (default JS string comparison).
 * - Object keys sorted lexicographically (ascending code-unit order).
 * - Compact: no whitespace, no indentation, no trailing newline.
 * - `undefined` object fields are omitted (never serialized).
 * - Array element order is preserved.
 * - `NaN`, `Infinity`, `-Infinity` are rejected (not valid JSON).
 * - Strings escaped per JSON.stringify rules, including lone UTF-16
 *   surrogates (escaped as `\uXXXX` for cross-runtime consistency).
 *
 * Inputs must be JSON-representable data (plain objects, arrays, strings,
 * numbers, booleans, null). Values with custom `toJSON()` methods (e.g.
 * `Date`) are treated as plain objects — their `toJSON()` is NOT called,
 * matching the explicit "manual recursive emitter" design that keeps the
 * wire format and hash input from drifting. Callers must convert such
 * values to JSON primitives before serialization.
 *
 * Implemented as a manual recursive emitter so the wire format and the hash
 * input can never drift from each other.
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
  if (typeof value === "string") {
    out.push(quoteString(value));
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    emitNumber(value, out);
    return;
  }
  if (typeof value === "bigint") {
    throw new TypeError("canonical JSON does not support bigint");
  }
  if (Array.isArray(value)) {
    emitArray(value, out);
    return;
  }
  if (typeof value === "object") {
    emitObject(value as Record<string, unknown>, out);
    return;
  }
  // functions, symbols, etc. — not representable.
  throw new TypeError(
    `canonical JSON does not support value of type ${typeof value}`,
  );
}

/** Emit a number, rejecting NaN/Infinity (not valid JSON). */
function emitNumber(value: number, out: string[]): void {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new TypeError(
      `canonical JSON does not support ${String(value)} (NaN/Infinity are not valid JSON)`,
    );
  }
  out.push(value.toString());
}

/** Emit an array, preserving element order. Undefined elements become null. */
function emitArray(arr: readonly unknown[], out: string[]): void {
  out.push("[");
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el === undefined) {
      // JSON.stringify emits null for undefined array elements.
      out.push("null");
    } else {
      emit(el, out);
    }
    if (i < arr.length - 1) out.push(",");
  }
  out.push("]");
}

function emitObject(obj: Record<string, unknown>, out: string[]): void {
  // Collect [key, value] pairs, omitting undefined values, sorted by key.
  const entries = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  out.push("{");
  let first = true;
  for (const [k, v] of entries) {
    if (!first) out.push(",");
    first = false;
    out.push(quoteString(k));
    out.push(":");
    emit(v, out);
  }
  out.push("}");
}

/**
 * Quote a string per JSON rules. Mirrors JSON.stringify's string escaping:
 * escapes ", \\, and control chars (< 0x20) using short escapes where defined
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
