import { createHash } from "node:crypto";
import type { OperationKind } from "../operation.js";
import { canonicalStringify } from "./canonical.js";

/**
 * Compute a deterministic, content-addressed operation id from kind, name,
 * and a context record of discriminating fields (matrix values, user-provided
 * spec.id folded in as `userId`, command, args, etc.).
 *
 * Algorithm (ADR-006 / spec 01-core §ID assignment): SHA-256 over the
 * canonical JSON of `{ kind, name, context }` (keys sorted, compact, UTF-8),
 * hex-encoded, prefixed with `op-`. Matrix expansion produces distinct ids
 * because each combination yields a distinct `context`. No external hashing
 * library — uses Node's built-in `node:crypto`.
 *
 * The `ir` package re-exports this function from `@sverka/core` so both
 * packages produce identical ids by construction. The core/ir consistency
 * test guards against drift.
 */
export function computeOperationId(
  kind: OperationKind,
  name: string,
  context: Readonly<Record<string, unknown>>,
): string {
  const canonical = canonicalStringify({ kind, name, context });
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `op-${hex}`;
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
