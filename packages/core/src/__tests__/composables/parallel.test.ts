import { describe, it, expect } from "vitest";
import { parallel } from "../../composables/parallel.js";
import { run } from "../../composables/run.js";
import { asNode } from "../../internal/node.js";

describe("parallel()", () => {
  it("returns a synthetic join node with all ops as siblings", () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const join = parallel(a, b, c);
    const joinNode = asNode(join);
    expect(joinNode.kind).toBe("custom");
    expect(joinNode.spec.name).toBe("parallel-join");
    expect(joinNode.siblings).toHaveLength(3);
    expect(asNode(joinNode.siblings[0]!).spec.command).toBe("a");
    expect(asNode(joinNode.siblings[1]!).spec.command).toBe("b");
    expect(asNode(joinNode.siblings[2]!).spec.command).toBe("c");
  });

  it("adds no dependency edges between siblings", () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const join = parallel(a, b);
    for (const sib of asNode(join).siblings) {
      expect(asNode(sib).predecessors).toEqual([]);
    }
  });

  it("does not mutate input operations", () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    parallel(a, b);
    expect(asNode(a).siblings).toEqual([]);
    expect(asNode(b).siblings).toEqual([]);
  });
});
