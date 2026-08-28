import type { Operation, OperationSpec } from "../operation.js";
import { asNode, createNode, type OperationNode } from "../internal/node.js";

/** Internal marker field name on an empty-pipeline artifact node. */
export const PIPELINE_EMPTY_MARKER = "__pipelineEmpty" as const;

/**
 * Compose operations into a sequential pipeline. Each operation depends on
 * the previous one, forming a linear chain in the DAG. Returns the tail
 * node; the planner walks predecessors to discover the full chain.
 *
 * @example
 * const p = pipeline(build, test, lint);
 */
export function pipeline(...operations: Operation[]): Operation {
  if (operations.length === 0) {
    return createNode("custom", {
      name: "pipeline-empty",
      [PIPELINE_EMPTY_MARKER]: true,
    } as Partial<OperationSpec> & Record<typeof PIPELINE_EMPTY_MARKER, true>);
  }
  let tail: OperationNode = asNode(operations[0]!);
  for (let i = 1; i < operations.length; i++) {
    const next = asNode(operations[i]!);
    tail = asNode(next.after(tail));
  }
  return tail;
}
