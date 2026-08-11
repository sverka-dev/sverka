import type { OperationKind, OperationSpec } from "../operation.js";
import type { OperationNode } from "./node.js";
import { canonicalJson } from "./canonical.js";

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
  const name = spec.name || spec.command || String(index);
  return `${kind}:${name}`;
}

/**
 * Build the id suffix for a matrix child: `${baseId}[k1=v1,k2=v2]`.
 * Dimensions are joined with `,` in stable insertion order.
 * Delimiter characters (`,`, `=`, `\`) in keys and values are escaped
 * with a backslash so that two different dimension sets cannot produce
 * the same id string.
 */
export function matrixChildId(
  baseId: string,
  dims: ReadonlyArray<readonly [string, unknown]>,
): string {
  const parts = dims.map(([k, v]) => `${escapeSegment(k)}=${formatMatrixValue(v)}`);
  return `${baseId}[${parts.join(",")}]`;
}

/** Escape the `,`, `=`, and `\` delimiter characters used in matrix ids. */
function escapeSegment(s: string): string {
  return s.replace(/[\\,=]/g, (ch) => `\\${ch}`);
}

function formatMatrixValue(v: unknown): string {
  if (typeof v === "string") return `s:${escapeSegment(v)}`;
  if (typeof v === "number") return `n:${String(v)}`;
  if (typeof v === "boolean") return `b:${String(v)}`;
  if (v === undefined) return `u:undefined`;
  return `u:${escapeSegment(canonicalJson(v))}`;
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

