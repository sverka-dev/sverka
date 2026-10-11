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

/**
 * Deep-freeze a spec-like value so callers cannot mutate it after the node
 * is created. This enforces the immutable-composition contract.
 */
function deepFreezeSpec<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const el of value) deepFreezeSpec(el);
    Object.freeze(value);
  } else {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      deepFreezeSpec((value as Record<string, unknown>)[k]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Shallow-clone and freeze the spec so the node owns an immutable snapshot.
 * Caller mutations to the original spec object cannot affect the node.
 */
function snapshotSpec(spec: Readonly<Partial<OperationSpec>>): Readonly<Partial<OperationSpec>> {
  return deepFreezeSpec({ ...spec });
}

/** Build an immutable {@link OperationNode} with working composable methods. */
function makeNode(fields: NodeFields): OperationNode {
  const { kind, spec, predecessors, siblings } = fields;
  const frozenSpec = snapshotSpec(spec);
  const node: OperationNode = {
    kind,
    spec: frozenSpec,
    predecessors,
    siblings,
    ...(fields._id !== undefined ? { _id: fields._id } : {}),
    after: (...predecessorsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec: frozenSpec,
        predecessors: [...predecessors, ...asNodes(predecessorsToAdd)],
        siblings,
      }),
    with: (...siblingsToAdd: Operation[]): Operation =>
      makeNode({
        kind,
        spec: frozenSpec,
        predecessors,
        siblings: [...siblings, ...asNodes(siblingsToAdd)],
      }),
    named: (name: string): Operation =>
      makeNode({ kind, spec: { ...frozenSpec, name }, predecessors, siblings }),
    tagged: (...tags: string[]): Operation =>
      makeNode({
        kind,
        spec: {
          ...frozenSpec,
          tags: concatDedupe([...(frozenSpec.tags ?? []), ...tags]),
        },
        predecessors,
        siblings,
      }),
  };
  return node;
}

/** Narrow an array of public Operations to OperationNodes, validating each. */
function asNodes(ops: readonly Operation[]): OperationNode[] {
  return ops.map((op) => {
    if (
      op !== null &&
      typeof op === "object" &&
      "predecessors" in op &&
      "siblings" in op
    ) {
      return op as OperationNode;
    }
    throw new TypeError(
      "expected an Operation created by run()/pipeline()/parallel()/etc., got a plain object",
    );
  });
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
