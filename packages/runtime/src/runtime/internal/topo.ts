import type { PlanOperation } from "@sverka/workflow";

/**
 * Result of a topological sort. Either a sorted list of operation ids, or a
 * detected cycle (the list of ids forming the cycle, in cycle order).
 */
export type TopoResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly cycle: readonly string[] };

/**
 * Topologically sort plan operations by their `dependsOn` edges.
 *
 * Returns the sorted id order, or a cycle path if the DAG contains a cycle.
 * A self-loop (an op depending on itself) is a cycle of length 1.
 * Operations are emitted in input order among ready siblings for determinism.
 */
export function topoSort(ops: readonly PlanOperation[]): TopoResult {
  const ids = new Set(ops.map((o) => o.id));
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  initGraph(ops, dependents, indegree);
  buildEdges(ops, ids, dependents, indegree);

  const order = kahnSort(ops, dependents, indegree);
  if (order.length === ops.length) {
    return { ok: true, order };
  }

  // Cycle: remaining ops have non-zero indegree. Extract a cycle path via DFS.
  const remaining = ops.filter((o) => (indegree.get(o.id) ?? 0) > 0);
  const cycle = findCycle(remaining);
  return { ok: false, cycle };
}

function initGraph(
  ops: readonly PlanOperation[],
  dependents: Map<string, string[]>,
  indegree: Map<string, number>,
): void {
  for (const op of ops) {
    dependents.set(op.id, []);
    indegree.set(op.id, 0);
  }
}

function buildEdges(
  ops: readonly PlanOperation[],
  ids: Set<string>,
  dependents: Map<string, string[]>,
  indegree: Map<string, number>,
): void {
  for (const op of ops) {
    for (const dep of op.dependsOn) {
      // Ignore deps that don't exist in the plan (IR validation rejects these,
      // but defend in depth by treating them as already-satisfied).
      if (!ids.has(dep)) continue;
      dependents.get(dep)?.push(op.id);
      indegree.set(op.id, (indegree.get(op.id) ?? 0) + 1);
    }
  }
}

/** Kahn's algorithm, preserving input order among ready siblings. */
function kahnSort(
  ops: readonly PlanOperation[],
  dependents: Map<string, string[]>,
  indegree: Map<string, number>,
): string[] {
  const ready: string[] = [];
  for (const op of ops) {
    if ((indegree.get(op.id) ?? 0) === 0) ready.push(op.id);
  }
  const order: string[] = [];
  let head = 0;
  while (head < ready.length) {
    const id = ready[head]!;
    head++;
    order.push(id);
    processDependents(id, dependents, indegree, ready);
  }
  return order;
}

function processDependents(
  id: string,
  dependents: Map<string, string[]>,
  indegree: Map<string, number>,
  ready: string[],
): void {
  for (const dep of dependents.get(id) ?? []) {
    const next = (indegree.get(dep) ?? 0) - 1;
    indegree.set(dep, next);
    if (next === 0) ready.push(dep);
  }
}

/**
 * Find a cycle among the given operations (which are known to be part of a
 * strongly-connected component). Returns a list of ids in cycle order.
 */
function findCycle(ops: readonly PlanOperation[]): readonly string[] {
  const ids = new Set(ops.map((o) => o.id));
  const adj = new Map<string, string[]>();
  for (const op of ops) {
    adj.set(op.id, op.dependsOn.filter((d) => ids.has(d)));
  }
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();
  let found: string[] | null = null;

  const dfs = (node: string): void => {
    if (found) return;
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (visited.has(next)) {
        if (onStack.has(next)) {
          found = stack.slice(stack.indexOf(next)).concat(next);
        }
      } else {
        dfs(next);
      }
      if (found) return;
    }
    onStack.delete(node);
    stack.pop();
  };

  for (const op of ops) {
    if (!visited.has(op.id)) dfs(op.id);
    if (found) break;
  }
  return found ?? ops.map((o) => o.id);
}

/**
 * Compute the transitive set of dependents of `id` (operations that depend on
 * `id`, directly or transitively). Used for cancellation on fatal failure.
 */
export function dependentsOf(
  ops: readonly PlanOperation[],
  id: string,
): Set<string> {
  const dependents = buildDependentMap(ops);
  return bfsDependents(dependents, id);
}

function buildDependentMap(
  ops: readonly PlanOperation[],
): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const op of ops) {
    for (const dep of op.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), op.id]);
    }
  }
  return dependents;
}

function bfsDependents(
  dependents: Map<string, string[]>,
  id: string,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [...(dependents.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (result.has(cur)) continue;
    result.add(cur);
    enqueueDependents(dependents, cur, result, queue);
  }
  return result;
}

function enqueueDependents(
  dependents: Map<string, string[]>,
  cur: string,
  result: Set<string>,
  queue: string[],
): void {
  for (const d of dependents.get(cur) ?? []) {
    if (!result.has(d)) queue.push(d);
  }
}
