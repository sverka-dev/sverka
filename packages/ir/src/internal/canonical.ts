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
  // Collect enumerable own string keys, omitting those whose value is undefined.
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    keys.push(k);
  }
  // Lexicographic by UTF-16 code unit (default String comparison).
  keys.sort();
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
 * and \u00XX otherwise. Lone UTF-16 surrogate code units (0xD800–0xDFFF not
 * part of a valid pair) are escaped as \uXXXX to ensure valid UTF-8 output.
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
        } else if (code >= 0xd800 && code <= 0xdfff) {
          // Lone surrogate: escape as \uXXXX for valid UTF-8 output.
          // Valid surrogate pairs (high followed by low) are emitted as-is
          // because they form a complete code point.
          if (code >= 0xdc00 && i > 0) {
            // Low surrogate — check if preceded by a high surrogate.
            const prev = s.charCodeAt(i - 1);
            if (prev >= 0xd800 && prev <= 0xdbff) {
              parts.push(ch);
              continue;
            }
          }
          if (code <= 0xdbff && i + 1 < s.length) {
            // High surrogate — check if followed by a low surrogate.
            const next = s.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
              parts.push(ch);
              continue;
            }
          }
          parts.push("\\u" + code.toString(16).padStart(4, "0"));
        } else {
          parts.push(ch);
        }
    }
  }
  parts.push('"');
  return parts.join("");
}
