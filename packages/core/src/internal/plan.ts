import type { Operation, OperationSpec } from "../operation.js";
import type { Runtime, RuntimeResult } from "../runtime.js";
import { asNode, createNode, withSpec, type OperationNode } from "./node.js";
import { assignId, matrixChildId, isKnownKind } from "./ids.js";
import { evaluateCondition } from "./conditions.js";
import { CoreError, CompositionError } from "../errors.js";

/** Marker field names used by composables to flag planning-only artifacts. */
const MATRIX_MARKER = "__matrixTemplate";
const JOIN_MARKER = "__joinArtifact";
const PIPELINE_EMPTY_MARKER = "__pipelineEmpty";

/**
 * Plan a workflow: walk roots, expand matrix, flatten artifact nodes, assign
 * ids, resolve edges, detect cycles, topo-sort, evaluate conditions, and
 * feed each operation to the runtime. Runs identically in all three modes —
 * the runtime decides whether to record, execute, or compile.
 */
export async function planWorkflow(
  roots: readonly Operation[],
  runtime: Runtime,
): Promise<RuntimeResult> {
  const start = nowMs();

  // 1. Discover all reachable nodes from roots (follow predecessors + siblings).
  const discovered = discover(roots);

  // 2. Expand matrix templates into cartesian-product children.
  const expanded = expandMatrices(discovered);

  // 3. Flatten artifact nodes (join / empty-pipeline): dependents of a join
  //    depend on its siblings instead; artifact nodes are then removed.
  const realNodes = flattenArtifacts(expanded);

  // 4. Assign deterministic ids; reject duplicate user ids.
  const idMap = assignIds(realNodes);

  // 5. Resolve predecessor refs → dependsOn string ids, merge with user deps.
  const specs = resolveEdges(realNodes, idMap);

  // 6. Cycle detection.
  detectCycles(specs);

  // 7. Topo sort.
  const ordered = topoSort(specs);

  // 8. Evaluate conditions and feed non-skipped ops to the runtime.
  for (const spec of ordered) {
    if (spec.condition !== undefined) {
      const included = evaluateCondition(spec.condition, runtime.context);
      if (!included) {
        // Skipped: do not call runtime.evaluate. The operation is still
        // recorded in the graph (in `ordered`) with its condition field.
        continue;
      }
    }
    await runtime.evaluate(spec);
  }

  // 9. Finalize via the runtime, merge planner metadata.
  const finalized = await runtime.finalize();
  return {
    ...finalized,
    operations: ordered,
    durationMs: nowMs() - start,
  };
}

function nowMs(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

function markerOf(node: OperationNode): string | undefined {
  const s = node.spec as unknown as Record<string, unknown>;
  if (s[JOIN_MARKER] === true) return JOIN_MARKER;
  if (s[PIPELINE_EMPTY_MARKER] === true) return PIPELINE_EMPTY_MARKER;
  if (s[MATRIX_MARKER] === true) return MATRIX_MARKER;
  return undefined;
}

function isArtifact(node: OperationNode): boolean {
  const m = markerOf(node);
  return m === JOIN_MARKER || m === PIPELINE_EMPTY_MARKER;
}

// ---------------------------------------------------------------------------
// 1. Discovery
// ---------------------------------------------------------------------------

/** Discover all reachable nodes from the roots via predecessors and siblings. */
function discover(roots: readonly Operation[]): OperationNode[] {
  const seen = new Set<OperationNode>();
  const stack: OperationNode[] = [];
  for (const r of roots) stack.push(asNode(r));
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const p of n.predecessors) stack.push(p);
    for (const s of n.siblings) stack.push(s);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// 2. Matrix expansion
// ---------------------------------------------------------------------------

/** Expand matrix template nodes into cartesian-product children. */
function expandMatrices(nodes: readonly OperationNode[]): OperationNode[] {
  const result: OperationNode[] = [];
  for (const node of nodes) {
    if (markerOf(node) !== MATRIX_MARKER) {
      result.push(node);
      continue;
    }
    const dims = node.spec.matrix;
    if (dims === undefined) {
      result.push(node);
      continue;
    }
    for (const [key, values] of Object.entries(dims)) {
      if (!Array.isArray(values)) {
        throw new CompositionError(
          `matrix dimension '${key}' is not an array`,
          { dimension: key, value: values },
        );
      }
      if (values.length === 0) {
        throw new CompositionError(`matrix dimension '${key}' is empty`, {
          dimension: key,
        });
      }
    }
    for (const combo of cartesianProduct(dims)) {
      const env: Record<string, string> = { ...(node.spec.env ?? {}) };
      for (const [k, v] of combo) env[`MATRIX_${k.toUpperCase()}`] = String(v);
      const childSpec = { ...node.spec };
      delete (childSpec as unknown as Record<string, unknown>)[MATRIX_MARKER];
      delete (childSpec as unknown as Record<string, unknown>).matrix;
      const child = withSpec(node, { ...childSpec, env });
      (child as unknown as Record<string, unknown>).__matrixCombo = combo;
      result.push(child);
    }
  }
  return result;
}

function cartesianProduct(
  dims: Readonly<Record<string, readonly unknown[]>>,
): ReadonlyArray<readonly [string, unknown][]> {
  const entries = Object.entries(dims);
  if (entries.length === 0) return [[]];
  const [first, ...rest] = entries;
  if (first === undefined) return [[]];
  const [dimKey, dimValues] = first;
  const restProduct = cartesianProduct(Object.fromEntries(rest));
  const result: Array<readonly [string, unknown][]> = [];
  for (const v of dimValues) {
    for (const combo of restProduct) result.push([[dimKey, v], ...combo]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Flatten artifacts
// ---------------------------------------------------------------------------

/**
 * Replace predecessor references to artifact nodes:
 * - join node → its siblings (recursively, in case a sibling is also a join)
 * - empty-pipeline node → dropped (no real predecessors)
 * Then remove artifact nodes from the set. Siblings of a join are reachable
 * on their own (they were discovered), so dropping the join is safe.
 */
function flattenArtifacts(nodes: readonly OperationNode[]): OperationNode[] {
  // Resolve a predecessor reference into the real nodes it should stand for.
  const resolvePred = (pred: OperationNode): OperationNode[] => {
    const m = markerOf(pred);
    if (m === JOIN_MARKER) {
      // Depend on the join's siblings (each resolved recursively).
      return pred.siblings.flatMap(resolvePred);
    }
    if (m === PIPELINE_EMPTY_MARKER) {
      return [];
    }
    return [pred];
  };

  const rewritten = nodes.map((node) => {
    if (node.predecessors.length === 0) return node;
    const newPreds = node.predecessors.flatMap(resolvePred);
    // Skip rebuild if nothing changed.
    const same =
      newPreds.length === node.predecessors.length &&
      newPreds.every((p, i) => p === node.predecessors[i]);
    if (same) return node;
    return makeNodeWith(node.kind, node.spec, newPreds, node.siblings, node._id);
  });

  return rewritten.filter((n) => !isArtifact(n));
}

/** Build a new node with the same spec/siblings but replaced predecessors. */
function makeNodeWith(
  kind: import("../operation.js").OperationKind,
  spec: Readonly<Partial<OperationSpec>>,
  predecessors: readonly OperationNode[],
  siblings: readonly OperationNode[],
  _id: string | undefined,
): OperationNode {
  // createNode yields a node with empty preds/siblings; reattach via the
  // immutable after()/with() API so the public contract is respected.
  let n = createNode(kind, spec);
  if (predecessors.length > 0) n = asNode(n.after(...predecessors));
  if (siblings.length > 0) n = asNode(n.with(...siblings));
  if (_id !== undefined) (n as unknown as { _id: string })._id = _id;
  return n;
}

// ---------------------------------------------------------------------------
// 4. ID assignment
// ---------------------------------------------------------------------------

/** Assign deterministic ids; reject duplicate user ids. */
function assignIds(nodes: readonly OperationNode[]): Map<OperationNode, string> {
  const idMap = new Map<OperationNode, string>();
  const usedIds = new Set<string>();
  nodes.forEach((node, index) => {
    if (!isKnownKind(node.kind)) {
      throw new CoreError(`unknown operation kind '${node.kind}'`, "UNKNOWN_KIND", {
        kind: node.kind,
      });
    }
    const combo = (node as unknown as Record<string, unknown>).__matrixCombo as
      | readonly [string, unknown][]
      | undefined;
    let id: string;
    if (combo !== undefined) {
      const base = assignId(stripId(node), index, new Set(usedIds));
      id = matrixChildId(base, combo);
    } else {
      id = assignId(node, index, usedIds);
    }
    if (node.spec.id !== undefined && usedIds.has(id)) {
      throw new CompositionError(`duplicate operation id '${id}'`, { id });
    }
    usedIds.add(id);
    idMap.set(node, id);
  });
  return idMap;
}

/** Return a node view with spec.id removed (for base-id derivation of children). */
function stripId(node: OperationNode): OperationNode {
  const { id: _omit, ...rest } = node.spec;
  return withSpec(node, rest);
}

// ---------------------------------------------------------------------------
// 5. Edge resolution
// ---------------------------------------------------------------------------

/** Resolve predecessor refs to dependsOn ids, merge with user deps, dedupe. */
function resolveEdges(
  nodes: readonly OperationNode[],
  idMap: Map<OperationNode, string>,
): Map<OperationNode, OperationSpec> {
  const result = new Map<OperationNode, OperationSpec>();
  for (const node of nodes) {
    const id = idMap.get(node)!;
    const userDeps = node.spec.dependsOn ?? [];
    const resolvedDeps = node.predecessors.map((p) => idMap.get(p));
    if (resolvedDeps.some((d) => d === undefined)) {
      throw new CompositionError("unresolved predecessor reference", { node: id });
    }
    const dependsOn = [...new Set([...userDeps, ...(resolvedDeps as string[])])];
    result.set(node, buildSpec(node, id, dependsOn));
  }
  return result;
}

function buildSpec(
  node: OperationNode,
  id: string,
  dependsOn: readonly string[],
): OperationSpec {
  const s = node.spec;
  return {
    id,
    kind: node.kind,
    name: s.name ?? "",
    ...(s.description !== undefined ? { description: s.description } : {}),
    ...(s.command !== undefined ? { command: s.command } : {}),
    ...(s.args !== undefined ? { args: s.args } : {}),
    ...(s.env !== undefined ? { env: s.env } : {}),
    ...(s.workingDir !== undefined ? { workingDir: s.workingDir } : {}),
    ...(s.image !== undefined ? { image: s.image } : {}),
    ...(s.imageDigest !== undefined ? { imageDigest: s.imageDigest } : {}),
    dependsOn,
    ...(s.condition !== undefined ? { condition: s.condition } : {}),
    ...(s.cpuLimit !== undefined ? { cpuLimit: s.cpuLimit } : {}),
    ...(s.memoryLimit !== undefined ? { memoryLimit: s.memoryLimit } : {}),
    ...(s.timeoutSeconds !== undefined ? { timeoutSeconds: s.timeoutSeconds } : {}),
    ...(s.retries !== undefined ? { retries: s.retries } : {}),
    ...(s.continueOnError !== undefined ? { continueOnError: s.continueOnError } : {}),
    ...(s.cache !== undefined ? { cache: s.cache } : {}),
    ...(s.artifacts !== undefined ? { artifacts: s.artifacts } : {}),
    ...(s.network !== undefined ? { network: s.network } : {}),
    ...(s.credentials !== undefined ? { credentials: s.credentials } : {}),
    ...(s.tags !== undefined ? { tags: s.tags } : {}),
  };
}

// ---------------------------------------------------------------------------
// 6. Cycle detection (DFS coloring)
// ---------------------------------------------------------------------------

function detectCycles(specs: Map<OperationNode, OperationSpec>): void {
  const byId = new Map<string, OperationSpec>();
  for (const spec of specs.values()) byId.set(spec.id, spec);
  const color = new Map<string, "white" | "gray" | "black">();
  for (const id of byId.keys()) color.set(id, "white");
  const stack: string[] = [];

  const visit = (id: string): void => {
    const c = color.get(id);
    if (c === "black") return;
    if (c === "gray") {
      const cycleStart = stack.indexOf(id);
      throw new CompositionError("cycle detected in operation graph", {
        cycle: stack.slice(cycleStart).concat(id),
      });
    }
    color.set(id, "gray");
    stack.push(id);
    const spec = byId.get(id)!;
    for (const dep of spec.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    stack.pop();
    color.set(id, "black");
  };
  for (const id of byId.keys()) visit(id);
}

// ---------------------------------------------------------------------------
// 7. Topological sort (Kahn's algorithm, stable by discovery order)
// ---------------------------------------------------------------------------

function topoSort(specs: Map<OperationNode, OperationSpec>): OperationSpec[] {
  const all = [...specs.values()];
  const byId = new Map(all.map((s) => [s.id, s] as const));
  const indegree = new Map<string, number>(all.map((s) => [s.id, 0] as const));
  const adj = new Map<string, string[]>(all.map((s) => [s.id, []] as const));
  for (const spec of all) {
    for (const dep of spec.dependsOn ?? []) {
      if (byId.has(dep)) {
        adj.get(dep)!.push(spec.id);
        indegree.set(spec.id, (indegree.get(spec.id) ?? 0) + 1);
      }
    }
  }
  const queue = all.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const ordered: OperationSpec[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (ordered.length !== all.length) {
    throw new CompositionError("topological sort failed (residual cycle)", {});
  }
  return ordered;
}
