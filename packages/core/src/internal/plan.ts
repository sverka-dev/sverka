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
  //    Independent operations are dispatched concurrently as a batch so
  //    siblings produced by `parallel()` run simultaneously.
  await evaluateOperations(ordered, runtime);

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

/**
 * Evaluate operations in topo order, respecting conditions and failure policy.
 * Operations with no outstanding dependencies are dispatched concurrently as
 * a batch, so siblings produced by `parallel()` run simultaneously.
 *
 * In compile mode, all operations are passed to the runtime so compilers
 * can emit them (including conditionally-skipped ones with their condition
 * field intact). In execute/plan mode, false conditions skip the operation
 * without calling runtime.evaluate().
 */
async function evaluateOperations(
  ordered: readonly OperationSpec[],
  runtime: Runtime,
): Promise<void> {
  let aborted = false;
  const done = new Set<string>();
  const remaining = new Set(ordered.map((o) => o.id));
  const byId = new Map(ordered.map((o) => [o.id, o] as const));

  while (remaining.size > 0) {
    const ready: OperationSpec[] = [];
    for (const id of remaining) {
      const spec = byId.get(id)!;
      const deps = spec.dependsOn ?? [];
      if (deps.every((d) => done.has(d) || !byId.has(d))) {
        ready.push(spec);
      }
    }
    if (ready.length === 0) {
      throw new CompositionError("no ready operations (residual cycle)", {});
    }

    const promises: Promise<OperationOutcome>[] = [];
    const promiseSpecs: OperationSpec[] = [];

    for (const spec of ready) {
      remaining.delete(spec.id);
      if (aborted) {
        done.add(spec.id);
        continue;
      }
      if (spec.condition !== undefined) {
        const included = evaluateCondition(spec.condition, runtime.context);
        if (!included) {
          if (runtime.mode === "compile") {
            promises.push(runtime.evaluate(spec));
            promiseSpecs.push(spec);
          } else {
            done.add(spec.id);
          }
          continue;
        }
      }
      promises.push(runtime.evaluate(spec));
      promiseSpecs.push(spec);
    }

    const results = await Promise.all(promises);
    for (let i = 0; i < results.length; i++) {
      const outcome = results[i]!;
      const spec = promiseSpecs[i]!;
      done.add(spec.id);
      if (outcome.status === "failure" && spec.continueOnError !== true) {
        aborted = true;
      }
    }
  }
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
  // Map from template node to its expanded children, so downstream nodes
  // that depend on the template can be rewritten to depend on all children.
  const templateChildren = new Map<OperationNode, OperationNode[]>();
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
    const children: OperationNode[] = [];
    for (const combo of cartesianProduct(dims)) {
      const env: Record<string, string> = { ...(node.spec.env ?? {}) };
      for (const [k, v] of combo) env[`MATRIX_${k.toUpperCase()}`] = String(v);
      const childSpec = { ...node.spec };
      delete (childSpec as unknown as Record<string, unknown>)[MATRIX_MARKER];
      delete (childSpec as unknown as Record<string, unknown>).matrix;
      const child = withSpec(node, { ...childSpec, env });
      (child as unknown as Record<string, unknown>).__matrixCombo = combo;
      children.push(child);
      result.push(child);
    }
    templateChildren.set(node, children);
  }

  // Rewrite predecessor references: any node that depended on a matrix
  // template now depends on all its expanded children instead.
  if (templateChildren.size > 0) {
    for (let i = 0; i < result.length; i++) {
      const node = result[i]!;
      if (node.predecessors.length === 0) continue;
      let changed = false;
      const newPreds: OperationNode[] = [];
      for (const pred of node.predecessors) {
        const children = templateChildren.get(pred);
        if (children !== undefined) {
          newPreds.push(...children);
          changed = true;
        } else {
          newPreds.push(pred);
        }
      }
      if (changed) {
        result[i] = makeNodeWith(node.kind, node.spec, newPreds, node.siblings, node._id);
      }
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
      // Depend on the join's siblings (each resolved recursively) AND the
      // join's own predecessors, so that dependencies from before the
      // parallel block are preserved.
      const resolved: OperationNode[] = [];
      for (const sib of pred.siblings) resolved.push(...resolvePred(sib));
      for (const predPred of pred.predecessors) resolved.push(...resolvePred(predPred));
      return resolved;
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
  const knownOpIds = new Set<string>(idMap.values());
  for (const node of nodes) {
    const id = idMap.get(node)!;
    const userDeps = node.spec.dependsOn ?? [];
    const resolvedUserDeps = userDeps.map((dep) => resolveDep(dep, knownOpIds));
    const resolvedDeps = node.predecessors.map((p) => idMap.get(p));
    if (resolvedDeps.some((d) => d === undefined)) {
      throw new CompositionError("unresolved predecessor reference", { node: id });
    }
    const dependsOn = [...new Set([...resolvedUserDeps, ...(resolvedDeps as string[])])];
    result.set(node, buildSpec(node, id, dependsOn));
  }
  return result;
}

/**
 * Resolve a single user-provided dependsOn string. It must be an op- id
 * already present in the plan; otherwise it is a dangling reference.
 */
function resolveDep(dep: string, knownOpIds: Set<string>): string {
  if (knownOpIds.has(dep)) return dep;
  throw new CompositionError(`unresolved dependsOn reference '${dep}'`, {
    dependsOn: dep,
  });
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

  // Iterative DFS with explicit frame stack to avoid call-stack overflow.
  const frames: Array<{ id: string; depIdx: number }> = [];
  const path: string[] = [];

  for (const startId of byId.keys()) {
    if (color.get(startId) !== "white") continue;
    frames.push({ id: startId, depIdx: 0 });
    color.set(startId, "gray");
    path.push(startId);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const spec = byId.get(frame.id)!;
      let nextDep: string | undefined;
      while (frame.depIdx < (spec.dependsOn ?? []).length) {
        const dep = (spec.dependsOn ?? [])[frame.depIdx]!;
        frame.depIdx++;
        if (byId.has(dep)) {
          nextDep = dep;
          break;
        }
      }
      if (nextDep !== undefined) {
        const depColor = color.get(nextDep);
        if (depColor === "gray") {
          const cycleStart = path.indexOf(nextDep);
          throw new CompositionError("cycle detected in operation graph", {
            cycle: path.slice(cycleStart).concat(nextDep),
          });
        }
        if (depColor === "white") {
          color.set(nextDep, "gray");
          path.push(nextDep);
          frames.push({ id: nextDep, depIdx: 0 });
        }
      } else {
        color.set(frame.id, "black");
        path.pop();
        frames.pop();
      }
    }
  }
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
