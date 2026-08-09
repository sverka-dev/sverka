import type { Operation, OperationSpec } from "../operation.js";
import { asNode, withSpec } from "../internal/node.js";

/** Internal marker field name on a matrix template node. */
export const MATRIX_MARKER = "__matrixTemplate" as const;

/**
 * Expand an operation across a matrix of variable values. Each combination
 * becomes a separate node in the graph with a deterministic id suffix at
 * planning time. Lazy: validation of dimensions (non-empty arrays) is
 * deferred to planning to preserve laziness.
 *
 * @example
 * const multi = matrix({ node: ["20", "22", "24"] }, test);
 */
export function matrix(
  dimensions: Readonly<Record<string, readonly unknown[]>>,
  operation: Operation,
): Operation {
  const node = asNode(operation);
  const spec = {
    ...node.spec,
    matrix: dimensions,
    [MATRIX_MARKER]: true,
  } as Partial<OperationSpec> & Record<typeof MATRIX_MARKER, true>;
  return withSpec(node, spec);
}
