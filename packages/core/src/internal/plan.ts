import type { Operation, OperationSpec } from "../operation.js";
import type { Runtime, RuntimeResult, OperationOutcome } from "../runtime.js";
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
  const { nodes: expanded, combos } = expandMatrices(discovered);

  // 3. Flatten artifact nodes (join / empty-pipeline): dependents of a join
  //    depend on its siblings instead; artifact nodes are then removed.
  const realNodes = flattenArtifacts(expanded);

  // 4. Assign deterministic ids; reject duplicate user ids.
  const idMap = assignIds(realNodes, combos);

  // 5. Resolve predecessor refs → dependsOn string ids, merge with user deps.
  const specs = resolveEdges(realNodes, idMap);

  // 6. Cycle detection.
  detectCycles(specs);

  // 7. Topo sort.
  const ordered = topoSort(specs);

  // 8. Evaluate conditions and feed non-skipped ops to the runtime.
  const outcomes: OperationOutcome[] = [];
  try {
    await evaluateOperations(ordered, runtime, outcomes);
  } catch (err) {
    // Ensure runtime.finalize() is called even when evaluate() rejects,
    // so executors can release containers, processes, and file handles.
    await runtime.finalize();
    throw err;
  }

  // 9. Finalize via the runtime, merge planner metadata.
  const finalized = await runtime.finalize();
  return {
    ...finalized,
    operations: ordered,
    outcomes,
    durationMs: nowMs() - start,
  };
}

/**
 * Evaluate operations in topo order, respecting conditions and failure policy.
 * In compile mode, all operations are passed to the runtime so compilers
 * can emit them (including conditionally-skipped ones with their condition
 * field intact). In execute/plan mode, false conditions produce a synthetic
 * "skipped" outcome without calling runtime.evaluate().
 */
async function outcomeForFalseCondition(
  spec: OperationSpec,
  runtime: Runtime,
): Promise<OperationOutcome> {
  // Compile mode still passes the operation to the compiler so the emitted
  // artifact keeps the condition field.
  if (runtime.mode === "compile") return runtime.evaluate(spec);
  return { operationId: spec.id, status: "skipped", durationMs: 0 };
}

function isSkipped(spec: OperationSpec, runtime: Runtime): boolean {
  return spec.condition !== undefined && !evaluateCondition(spec.condition, runtime.context);
}

async function evaluateOperations(
  ordered: readonly OperationSpec[],
  runtime: Runtime,
  outcomes: OperationOutcome[],
): Promise<void> {
  let aborted = false;
  for (const spec of ordered) {
    if (aborted) {
      outcomes.push({ operationId: spec.id, status: "cancelled", durationMs: 0 });
      continue;
    }
    if (isSkipped(spec, runtime)) {
      outcomes.push(await outcomeForFalseCondition(spec, runtime));
      continue;
    }
    const outcome = await runtime.evaluate(spec);
    outcomes.push(outcome);
    if (outcome.status === "failure" && spec.continueOnError !== true) {
      aborted = true;
    }
  }
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

/** Maximum number of matrix combinations before a CompositionError is raised. */
const MAX_MATRIX_COMBINATIONS = 256;

/** Expand matrix template nodes into cartesian-product children.
 * Returns the expanded nodes and a Map from each child to its combo. */
function expandMatrices(
  nodes: readonly OperationNode[],
): { nodes: OperationNode[]; combos: Map<OperationNode, readonly [string, unknown][]> } {
  const result: OperationNode[] = [];
  const combos = new Map<OperationNode, readonly [string, unknown][]>();
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
    validateDims(dims);
    for (const combo of cartesianProduct(dims)) {
      result.push(buildMatrixChild(node, combo, combos));
    }
  }
  return { nodes: result, combos };
}

/** Validate that all matrix dimensions are non-empty arrays. */
function validateDims(dims: Readonly<Record<string, readonly unknown[]>>): void {
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
}

/** Build a matrix child node from a template and a dimension combination. */
function buildMatrixChild(
  node: OperationNode,
  combo: readonly [string, unknown][],
  combos: Map<OperationNode, readonly [string, unknown][]>,
): OperationNode {
  const env: Record<string, string> = { ...node.spec.env };
  for (const [k, v] of combo) {
    env[`MATRIX_${k.toUpperCase()}`] =
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  }
  const childSpec = { ...node.spec };
  delete (childSpec as unknown as Record<string, unknown>)[MATRIX_MARKER];
  delete (childSpec as unknown as Record<string, unknown>).matrix;
  const child = withSpec(node, { ...childSpec, env });
  combos.set(child, combo);
  return child;
}

function cartesianProduct(
  dims: Readonly<Record<string, readonly unknown[]>>,
): ReadonlyArray<readonly [string, unknown][]> {
  const entries = Object.entries(dims);
  if (entries.length === 0) return [[]];
  const [first, ...rest] = entries;
  if (first === undefined) return [[]];
  const [dimKey, dimValues] = first;

  const total = dimValues.length * cartesianProductCount(Object.fromEntries(rest));
  if (total > MAX_MATRIX_COMBINATIONS) {
    const dimSummary = entries.map(([k, v]) => `${k}=${v.length}`).join(", ");
    throw new CompositionError(
      `matrix cartesian product exceeds limit of ${MAX_MATRIX_COMBINATIONS} (dimensions: ${dimSummary})`,
      { dimensions: Object.fromEntries(entries.map(([k, v]) => [k, v.length])) },
    );
  }

  const restProduct = cartesianProduct(Object.fromEntries(rest));
  const result: Array<readonly [string, unknown][]> = [];
  for (const v of dimValues) {
    for (const combo of restProduct) result.push([[dimKey, v], ...combo]);
  }
  return result;
}

function cartesianProductCount(dims: Readonly<Record<string, readonly unknown[]>>): number {
  const entries = Object.entries(dims);
  if (entries.length === 0) return 1;
  const [first, ...rest] = entries;
  if (first === undefined) return 1;
  return first[1].length * cartesianProductCount(Object.fromEntries(rest));
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
 *
 * If a join node carries a `condition` (e.g. from `when(cond, parallel(...))`),
 * the condition is propagated to each sibling that doesn't already have one.
 * A sibling with an existing condition gets a combined `(${existing} && ${join})`
 * condition so both guards are honored.
 */
function flattenArtifacts(nodes: readonly OperationNode[]): OperationNode[] {
  // Collect conditions from join nodes to propagate to their siblings.
  const joinConditions = new Map<OperationNode, string | undefined>();
  for (const node of nodes) {
    if (markerOf(node) === JOIN_MARKER && node.spec.condition !== undefined) {
      for (const sib of node.siblings) {
        const prev = joinConditions.get(sib);
        const joinCond = node.spec.condition;
        if (prev === undefined) {
          joinConditions.set(sib, joinCond);
        } else {
          // Combine: both the sibling's own condition and the join condition
          // must be true. We use a simple `&&` expression.
          joinConditions.set(sib, `(${prev} && ${joinCond})`);
        }
      }
    }
  }

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
    // Propagate join condition to siblings.
    const joinCond = joinConditions.get(node);
    if (joinCond !== undefined && !isArtifact(node)) {
      const existing = node.spec.condition;
      const combined = existing !== undefined ? `(${existing} && ${joinCond})` : joinCond;
      if (combined !== existing) {
        const newSpec = { ...node.spec, condition: combined };
        return makeNodeWith(node.kind, newSpec, node.predecessors, node.siblings, node._id);
      }
    }
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

/** Assign deterministic ids; reject duplicate user ids and matrix collisions. */
function assignIds(
  nodes: readonly OperationNode[],
  combos: Map<OperationNode, readonly [string, unknown][]>,
): Map<OperationNode, string> {
  const idMap = new Map<OperationNode, string>();
  const usedIds = new Set<string>();
  nodes.forEach((node, index) => {
    if (!isKnownKind(node.kind)) {
      throw new CoreError(`unknown operation kind '${node.kind}'`, "UNKNOWN_KIND", {
        kind: node.kind,
      });
    }
    const combo = combos.get(node);
    let id: string;
    if (combo !== undefined) {
      const base = assignId(stripId(node), index, new Set(usedIds));
      id = matrixChildId(base, combo);
    } else {
      id = assignId(node, index, usedIds);
    }
    if (usedIds.has(id)) {
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
    if (resolvedDeps.includes(undefined)) {
      throw new CompositionError("unresolved predecessor reference", { node: id });
    }
    const dependsOn = [...new Set([...userDeps, ...(resolvedDeps as string[])])];
    result.set(node, buildSpec(node, id, dependsOn));
  }
  return result;
}

const OPTIONAL_SPEC_KEYS = [
  "description", "command", "args", "env", "workingDir", "image", "imageDigest",
  "condition", "cpuLimit", "memoryLimit", "timeoutSeconds", "retries",
  "continueOnError", "cache", "artifacts", "network", "credentials", "tags",
] as const satisfies readonly (keyof OperationSpec)[];

function buildSpec(
  node: OperationNode,
  id: string,
  dependsOn: readonly string[],
): OperationSpec {
  const s = node.spec;
  const optional: Partial<OperationSpec> = {};
  for (const key of OPTIONAL_SPEC_KEYS) {
    if (s[key] !== undefined) {
      Object.assign(optional, { [key]: s[key] });
    }
  }
  return { id, kind: node.kind, name: s.name ?? "", dependsOn, ...optional };
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
      if (!byId.has(dep)) {
        throw new CompositionError(
          `operation '${id}' depends on unknown id '${dep}'`,
          { id, unknownDep: dep },
        );
      }
      visit(dep);
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
  const { indegree, adj } = buildDependencyGraph(all);
  const ordered = kahnSort(all, byId, indegree, adj);
  if (ordered.length !== all.length) {
    throw new CompositionError("topological sort failed (residual cycle)", {});
  }
  return ordered;
}

function buildDependencyGraph(
  all: OperationSpec[],
): {
  indegree: Map<string, number>;
  adj: Map<string, string[]>;
} {
  const indegree = new Map<string, number>(all.map((s) => [s.id, 0] as const));
  const adj = new Map<string, string[]>(all.map((s) => [s.id, []] as const));
  for (const spec of all) {
    for (const dep of spec.dependsOn ?? []) {
      // Unknown-dependency validation is done in detectCycles() which runs
      // before topoSort; skip the duplicate check here.
      adj.get(dep)!.push(spec.id);
      indegree.set(spec.id, (indegree.get(spec.id) ?? 0) + 1);
    }
  }
  return { indegree, adj };
}

function kahnSort(
  all: OperationSpec[],
  byId: Map<string, OperationSpec>,
  indegree: Map<string, number>,
  adj: Map<string, string[]>,
): OperationSpec[] {
  const queue = all.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const ordered: OperationSpec[] = [];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head++;
    ordered.push(byId.get(id)!);
    for (const next of adj.get(id) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return ordered;
}
