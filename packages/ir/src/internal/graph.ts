/**
 * A minimal operation view for cycle detection: just the id and its
 * dependency ids. The full operation shape is not required.
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
 * Uses an iterative DFS with WHITE/GRAY/BLACK coloring to avoid call-stack
 * overflow on deep dependency graphs. Dependencies that reference unknown
 * ids are ignored here -- the caller validates those separately (rule 4).
 * Only edges between known operations are traversed.
 */
export function findCycle(
  operations: readonly CycleNode[],
): string[] | undefined {
  const byId = new Map<string, CycleNode>();
  for (const op of operations) byId.set(op.id, op);

  const color = new Map<string, Color>();
  for (const op of operations) color.set(op.id, "white");

  const frames: Array<{ id: string; depIdx: number }> = [];
  const path: string[] = [];
  let found: string[] | undefined;

  for (const op of operations) {
    if (found !== undefined) break;
    if (color.get(op.id) !== "white") continue;
    frames.push({ id: op.id, depIdx: 0 });
    color.set(op.id, "gray");
    path.push(op.id);

    while (frames.length > 0) {
      if (found !== undefined) break;
      const frame = frames[frames.length - 1]!;
      const node = byId.get(frame.id);
      let nextDep: string | undefined;
      if (node !== undefined) {
        while (frame.depIdx < node.dependsOn.length) {
          const dep = node.dependsOn[frame.depIdx]!;
          frame.depIdx++;
          if (byId.has(dep)) {
            nextDep = dep;
            break;
          }
        }
      }
      if (nextDep !== undefined) {
        const depColor = color.get(nextDep);
        if (depColor === "gray") {
          const start = path.indexOf(nextDep);
          found = path.slice(start).concat(nextDep);
          break;
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
  return found;
}

type Color = "white" | "gray" | "black";
