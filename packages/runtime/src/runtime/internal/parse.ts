/**
 * Parse a CPU request string into a fractional CPU count.
 *
 * Accepts decimal strings like "2", "0.5", "1.5". Returns the numeric value.
 * Throws if the string is not a positive finite number.
 */
export function parseCpu(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`invalid cpu value: ${s}`);
  }
  return n;
}

const MEM_RE = /^(\d+)(Ki|Mi|Gi|Ti)?$/;
const MEM_UNITS: Readonly<Record<string, number>> = {
  "": 1,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
};

/**
 * Parse a memory request string into a byte count.
 *
 * Accepts a bare number (bytes) or a number with a binary suffix
 * (Ki, Mi, Gi, Ti). Returns the byte count. Throws on malformed input.
 */
export function parseMemory(s: string): number {
  const m = MEM_RE.exec(s);
  if (!m) {
    throw new RangeError(`invalid memory value: ${s}`);
  }
  const value = Number(m[1]);
  const unit = m[2] ?? "";
  const mult = MEM_UNITS[unit];
  if (mult === undefined) {
    throw new RangeError(`invalid memory unit: ${unit}`);
  }
  return value * mult;
}
