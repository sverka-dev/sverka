import type { Operation } from "../operation.js";
import { createNode, type OperationNode } from "../internal/node.js";

/** Internal marker field name on a synthetic join node (planning artifact). */
export const JOIN_MARKER = "__joinArtifact" as const;

/**
 * Compose operations to run concurrently. No dependency edges are added
 * between siblings; they share the same implicit join point. The returned
 * synthetic join node is a planning artifact — only the siblings appear in
 * the emitted `OperationSpec[]`, with no inter-sibling `dependsOn`.
 *
 * @example
 * const all = parallel(lint, test, typecheck);
 */
export function parallel(...operations: Operation[]): Operation {
  const join: OperationNode = createNode("custom", {
    name: "parallel-join",
    [JOIN_MARKER]: true,
  } as Partial<import("../operation.js").OperationSpec> &
    Record<typeof JOIN_MARKER, true>);
  if (operations.length === 0) return join;
  return join.with(...operations);
}
