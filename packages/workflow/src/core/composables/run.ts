import type { Operation, OperationSpec } from "../operation.js";
import { createNode } from "../internal/node.js";

/**
 * Define a single run operation. Lazy: no side effects at call time.
 *
 * @example
 * const lint = run({ command: "eslint", args: ["."], image: "node:24" });
 */
export function run(spec: Readonly<Partial<OperationSpec>>): Operation {
  return createNode(spec.kind ?? "run", spec);
}
