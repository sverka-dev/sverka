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
 * - Strings escaped per JSON.stringify rules.
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
  // functions, symbols, etc. — not representable.
  throw new TypeError(
    `canonical JSON does not support value of type ${typeof value}`,
  );
}

function emitArray(value: unknown[], out: string[]): void {
  out.push("[");
  for (let i = 0; i < value.length; i++) {
    const el = value[i];
    if (el === undefined) {
      // JSON.stringify emits null for undefined array elements.
      out.push("null");
    } else {
      emit(el, out);
    }
    if (i < value.length - 1) out.push(",");
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
  // NOTE: localeCompare is locale-sensitive and would violate the spec's
  // byte-wise UTF-16 ordering, so we use the default comparison explicitly.
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
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    switch (ch) {
      case '"':
        parts.push(String.raw`\"`);
        break;
      case "\\":
        parts.push(String.raw`\\`);
        break;
      case "\b":
        parts.push(String.raw`\b`);
        break;
      case "\t":
        parts.push(String.raw`\t`);
        break;
      case "\n":
        parts.push(String.raw`\n`);
        break;
      case "\f":
        parts.push(String.raw`\f`);
        break;
      case "\r":
        parts.push(String.raw`\r`);
        break;
      default:
        if (code < 0x20) {
          parts.push(String.raw`\u` + code.toString(16).padStart(4, "0"));
        } else {
          parts.push(ch);
        }
    }
  }
  parts.push('"');
  return parts.join("");
}
