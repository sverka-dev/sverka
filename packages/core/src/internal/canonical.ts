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
      out.push("null");
      return;
    }
    out.push(Number(value).toString());
    return;
  }
  throw new TypeError(
    `canonical JSON does not support value of type ${typeof value}`,
  );
}

function emitArray(value: unknown[], out: string[]): void {
  const filtered = value.filter((v) => v !== undefined);
  out.push("[");
  for (let i = 0; i < filtered.length; i++) {
    emit(filtered[i], out);
    if (i < filtered.length - 1) out.push(",");
  }
  out.push("]");
}

function emitObject(obj: Record<string, unknown>, out: string[]): void {
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    keys.push(k);
  }
  // Code-unit order (RFC 8785). Locale-aware comparison is not deterministic
  // across runtimes and ICU builds.
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
