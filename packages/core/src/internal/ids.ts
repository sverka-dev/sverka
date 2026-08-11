import type { OperationKind, OperationSpec } from "../operation.js";
import type { OperationNode } from "./node.js";

/**
 * Assign a deterministic id to a node during planning.
 *
 * Precedence:
 * 1. User-provided `spec.id` — used as-is. Duplicate user ids are rejected
 *    by the caller (not here).
 * 2. Derived id — `${kind}:${name || command || index}`.
 * 3. On collision (only when no user id was given), a monotonic counter
 *    suffix is appended.
 */
export function assignId(
  node: OperationNode,
  index: number,
  usedIds: Set<string>,
): string {
  const spec = node.spec;
  if (spec.id !== undefined) {
    return spec.id;
  }
  const base = derivedBase(node, index);
  if (!usedIds.has(base)) return base;
  let counter = 2;
  while (usedIds.has(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
}

function derivedBase(node: OperationNode, index: number): string {
  const { kind, spec } = node;
  const name = spec.name ?? spec.command ?? String(index);
  return `${kind}:${name}`;
}

/**
 * Build the id suffix for a matrix child: `${baseId}[k1=v1,k2=v2]`.
 * Dimensions are joined with `,` in stable insertion order.
 */
export function matrixChildId(
  baseId: string,
  dims: ReadonlyArray<readonly [string, unknown]>,
): string {
  const parts = dims.map(([k, v]) => `${k}=${formatMatrixValue(v)}`);
  return `${baseId}[${parts.join(",")}]`;
}

function formatMatrixValue(v: unknown): string {
  // Primitives use String() for backward compatibility.
  // Objects use a type-tagged representation that distinguishes
  // Map, Set, Array, and plain objects without collisions.
  // JSON.stringify maps distinct values (Map, Set, {}, {value:undefined})
  // to "{}" and throws TypeError for cyclic objects, so we avoid it.
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "object") {
    if (Array.isArray(v)) return `array:${encodeArray(v)}`;
    if (v instanceof Map) return `map:${encodeMap(v)}`;
    if (v instanceof Set) return `set:${encodeSet(v)}`;
    return `object:${encodeObject(v as Record<string, unknown>)}`;
  }
  return String(v);
}

function encodeArray(arr: unknown[]): string {
  return `[${arr.map(formatMatrixValue).join(",")}]`;
}

function encodeMap(m: Map<unknown, unknown>): string {
  const entries = Array.from(m.entries()).map(([k, val]) => `${formatMatrixValue(k)}:${formatMatrixValue(val)}`);
  return `{${entries.join(",")}}`;
}

function encodeSet(s: Set<unknown>): string {
  const values = Array.from(s).map(formatMatrixValue);
  return `{${values.join(",")}}`;
}

function encodeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${formatMatrixValue(k)}:${formatMatrixValue(obj[k])}`);
  return `{${entries.join(",")}}`;
}

/** Validate that a kind is a known {@link OperationKind}. */
export function isKnownKind(kind: string): kind is OperationKind {
  return (
    kind === "run" ||
    kind === "check" ||
    kind === "build" ||
    kind === "analyze" ||
    kind === "fetch" ||
    kind === "publish" ||
    kind === "custom"
  );
}

/** Public spec id helper — exposed for tests that build specs directly. */
export function specId(
  spec: Readonly<Partial<OperationSpec>>,
): string | undefined {
  return spec.id;
}
