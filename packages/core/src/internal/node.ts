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
 * Deep-clone the spec's array and record fields so later mutation by the
 * caller cannot affect the node. Primitives and undefined are passed through.
 */
function snapshotSpec(spec: Readonly<Partial<OperationSpec>>): Readonly<Partial<OperationSpec>> {
  const snapshot: Partial<OperationSpec> = { ...spec };
  // Clone known array fields.
  if (snapshot.args !== undefined) snapshot.args = [...snapshot.args];
  if (snapshot.dependsOn !== undefined) snapshot.dependsOn = [...snapshot.dependsOn];
  if (snapshot.tags !== undefined) snapshot.tags = [...snapshot.tags];
  if (snapshot.artifacts !== undefined) snapshot.artifacts = snapshot.artifacts.map((a) => ({ ...a }));
  if (snapshot.credentials !== undefined) snapshot.credentials = snapshot.credentials.map((c) => ({ ...c }));
  // Clone known record fields.
  if (snapshot.env !== undefined) snapshot.env = { ...snapshot.env };
  if (snapshot.cache !== undefined) snapshot.cache = { ...snapshot.cache };
  // Clone matrix dimensions (record of arrays).
  if (snapshot.matrix !== undefined) {
    const m: Record<string, readonly unknown[]> = {};
    for (const [k, v] of Object.entries(snapshot.matrix)) m[k] = [...v];
    snapshot.matrix = m;
  }
  return snapshot;
}

/** Build an immutable {@link OperationNode} with working composable methods. */
function makeNode(fields: NodeFields): OperationNode {
  const { kind, predecessors, siblings } = fields;
  const spec = snapshotSpec(fields.spec);
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
        predecessors: [
          ...predecessors,
          ...(predecessorsToAdd as OperationNode[]),
        ],
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

/**
 * Type guard: narrow a public {@link Operation} to an internal node.
 * Throws if the value does not have the required internal fields
 * (`kind`, `spec`, `predecessors`, `siblings`).
 */
export function asNode(operation: Operation): OperationNode {
  const candidate = operation as unknown as Partial<OperationNode>;
  if (
    typeof candidate.kind !== "string" ||
    typeof candidate.spec !== "object" ||
    candidate.spec === null ||
    !Array.isArray(candidate.predecessors) ||
    !Array.isArray(candidate.siblings)
  ) {
    throw new TypeError("expected an OperationNode, got a plain Operation");
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
