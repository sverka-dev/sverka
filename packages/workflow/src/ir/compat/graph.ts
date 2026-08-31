/**
 * A minimal operation view for cycle detection: just the id and its
 * dependency ids. The full {@link PlanOperation} is not required.
 */
export interface CycleNode {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

/**
 * Detect a cycle in the operation dependency graph. Returns the offending id
 * path (e.g. `["a", "b", "c", "a"]`) if a cycle exists, or `undefined` if the
 * graph is acyclic. A self-loop (`a` depends on `a`) is a cycle of length 1
 * and is reported as `["a", "a"]`.
 *
 * Uses DFS with WHITE/GRAY/BLACK coloring. Dependencies that reference
 * unknown ids are ignored here — the caller validates those separately
 * (rule 4). Only edges between known operations are traversed.
 */
export function findCycle(
  operations: readonly CycleNode[],
): string[] | undefined {
  const byId = new Map<string, CycleNode>();
  for (const op of operations) byId.set(op.id, op);

  const color = new Map<string, Color>();
  for (const op of operations) color.set(op.id, "white");
  const stack: string[] = [];

  let found: string[] | undefined;

  const visit = (id: string): void => {
    if (found !== undefined) return;
    const c = color.get(id);
    if (c === "black") return;
    if (c === "gray") {
      const start = stack.indexOf(id);
      found = stack.slice(start).concat(id);
      return;
    }
    color.set(id, "gray");
    stack.push(id);
    const op = byId.get(id);
    if (op !== undefined) {
      for (const dep of op.dependsOn) {
        // Only traverse known deps; unknown deps are rule 4's concern.
        if (byId.has(dep)) visit(dep);
        if (found !== undefined) return;
      }
    }
    stack.pop();
    color.set(id, "black");
  };

  for (const op of operations) {
    if (found !== undefined) break;
    if (color.get(op.id) === "white") visit(op.id);
  }
  return found;
}

type Color = "white" | "gray" | "black";
