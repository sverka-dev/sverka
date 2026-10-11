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
  // Snapshot the spec so later caller mutation does not alter planned nodes.
  const specSnapshot: Readonly<Partial<OperationSpec>> = { ...spec };
  const node: OperationNode = {
    kind,
    spec: specSnapshot,
    predecessors,
    siblings,
    ...(fields._id !== undefined ? { _id: fields._id } : {}),
    after: (...predecessorsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec: specSnapshot,
        predecessors: [...predecessors, ...predecessorsToAdd.map(asNode)],
        siblings,
      }),
    with: (...siblingsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec: specSnapshot,
        predecessors,
        siblings: [...siblings, ...siblingsToAdd.map(asNode)],
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

/** Type guard: narrow a public {@link Operation} to an internal node.
 * Throws if the object lacks the internal `predecessors`/`siblings` arrays,
 * preventing plain `Operation` objects from being confused with nodes. */
export function asNode(operation: Operation): OperationNode {
  const candidate = operation as unknown as Partial<OperationNode>;
  if (
    !Array.isArray(candidate.predecessors) ||
    !Array.isArray(candidate.siblings)
  ) {
    throw new TypeError(
      "expected an OperationNode with predecessors and siblings arrays, got a plain Operation",
    );
  }
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
