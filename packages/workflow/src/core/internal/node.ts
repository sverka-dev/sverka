import type { Operation, OperationKind, OperationSpec } from "../operation.js";
import { concatDedupe } from "./merge.js";

/**
 * Internal operation node. Extends the public {@link Operation} with
 * predecessor and sibling references used for graph construction. Not
 * exported from the public API.
 *
 * @internal
 */
export interface OperationNode extends Operation {
  readonly predecessors: readonly OperationNode[];
  readonly siblings: readonly OperationNode[];
}

interface NodeFields {
  readonly kind: OperationKind;
  readonly spec: Readonly<Partial<OperationSpec>>;
  readonly predecessors: readonly OperationNode[];
  readonly siblings: readonly OperationNode[];
  readonly _id?: string;
}

/** Build an immutable {@link OperationNode} with working composable methods. */
function makeNode(fields: NodeFields): OperationNode {
  const { kind, spec, predecessors, siblings } = fields;
  const node: OperationNode = {
    kind,
    spec,
    predecessors,
    siblings,
    ...(fields._id !== undefined ? { _id: fields._id } : {}),
    after: (...predecessorsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec,
        predecessors: [...predecessors, ...(predecessorsToAdd as OperationNode[])],
        siblings,
      }),
    with: (...siblingsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec,
        predecessors,
        siblings: [...siblings, ...(siblingsToAdd as OperationNode[])],
      }),
    named: (name: string): Operation =>
      makeNode({ kind, spec: { ...spec, name }, predecessors, siblings }),
    tagged: (...tags: string[]): Operation =>
      makeNode({
        kind,
        spec: {
          ...spec,
          tags: concatDedupe([...(spec.tags ?? []), ...tags]),
        },
        predecessors,
        siblings,
      }),
  };
  return node;
}

/** Create a fresh operation node with no predecessors or siblings. */
export function createNode(
  kind: OperationKind,
  spec: Readonly<Partial<OperationSpec>>,
): OperationNode {
  return makeNode({ kind, spec, predecessors: [], siblings: [] });
}

/** Type guard: narrow a public {@link Operation} to an internal node. */
export function asNode(operation: Operation): OperationNode {
  return operation as OperationNode;
}

/**
 * Return a new node with the same graph edges but a replaced spec. Used by
 * composables that need to attach a spec field (e.g. `when()` sets
 * `condition`) without losing predecessor/sibling wiring.
 */
export function withSpec(
  node: OperationNode,
  spec: Readonly<Partial<OperationSpec>>,
): OperationNode {
  return makeNode({
    kind: node.kind,
    spec,
    predecessors: node.predecessors,
    siblings: node.siblings,
    ...(node._id !== undefined ? { _id: node._id } : {}),
  });
}
