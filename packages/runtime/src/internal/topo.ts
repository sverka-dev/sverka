import type { PlanOperation } from "@sverka/ir";

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
  // Adjacency: dep -> dependents (forward edges in execution order).
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const op of ops) {
    dependents.set(op.id, []);
    indegree.set(op.id, 0);
  }
  buildEdges(ops, ids, dependents, indegree);

  // Kahn's algorithm, preserving input order among ready siblings.
  const ready: string[] = [];
  for (const op of ops) {
    if ((indegree.get(op.id) ?? 0) === 0) ready.push(op.id);
  }
  const order: string[] = [];
  // Track position in the ready queue for BFS-style processing.
  let head = 0;
  while (head < ready.length) {
    const id = ready[head]!;
    head++;
    order.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) ready.push(dep);
    }
  }

  if (order.length === ops.length) {
    return { ok: true, order };
  }

  // Cycle: remaining ops have non-zero indegree. Extract a cycle path via DFS.
  const remaining = ops.filter((o) => (indegree.get(o.id) ?? 0) > 0);
  const cycle = findCycle(remaining);
  return { ok: false, cycle };
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

/**
 * Find a cycle among the given operations (which are known to be part of a
 * strongly-connected component). Returns a list of ids in cycle order.
 */
function findCycle(ops: readonly PlanOperation[]): readonly string[] {
  const ids = new Set(ops.map((o) => o.id));
  const adj = new Map<string, string[]>();
  for (const op of ops) {
    adj.set(
      op.id,
      op.dependsOn.filter((d) => ids.has(d)),
    );
  }
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();
  let found: string[] | null = null;

  function dfs(node: string): void {
    if (found) return;
    visited.add(node);
    onStack.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (onStack.has(next)) {
        const start = stack.indexOf(next);
        found = stack.slice(start).concat(next);
      }
      if (found) return;
    }
    onStack.delete(node);
    stack.pop();
  }

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
  const dependents = new Map<string, string[]>();
  for (const op of ops) {
    for (const dep of op.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), op.id]);
    }
  }
  const result = new Set<string>();
  const queue: string[] = [...(dependents.get(id) ?? [])];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (result.has(cur)) continue;
    result.add(cur);
    for (const d of dependents.get(cur) ?? []) {
      if (!result.has(d)) queue.push(d);
    }
  }
  return result;
}
