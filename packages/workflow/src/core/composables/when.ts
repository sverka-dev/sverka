import type { Operation } from "../operation.js";
import { asNode, withSpec } from "../internal/node.js";

/**
 * Conditionally include an operation. The condition is an expression string
 * evaluated at plan time against the plan context. When the condition is
 * false the operation is recorded but marked skipped. Lazy: never throws at
 * call time (validation deferred to planning).
 *
 * @example
 * const nightly = when("schedule == 'nightly'", fullScan);
 */
export function when(condition: string, operation: Operation): Operation {
  const node = asNode(operation);
  return withSpec(node, { ...node.spec, condition });
}
