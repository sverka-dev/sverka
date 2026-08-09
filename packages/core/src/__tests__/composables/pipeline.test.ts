import { describe, it, expect } from "vitest";
import { pipeline } from "../../composables/pipeline.js";
import { run } from "../../composables/run.js";
import { asNode } from "../../internal/node.js";

describe("pipeline()", () => {
  it("wires a linear chain via predecessors and returns the tail", () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const tail = pipeline(a, b, c);
    // tail is c, with predecessor b
    const tailNode = asNode(tail);
    expect(tailNode.spec.command).toBe("c");
    expect(tailNode.predecessors).toHaveLength(1);
    const bNode = asNode(tailNode.predecessors[0]!);
    expect(bNode.spec.command).toBe("b");
    expect(bNode.predecessors).toHaveLength(1);
    const aNode = asNode(bNode.predecessors[0]!);
    expect(aNode.spec.command).toBe("a");
    expect(aNode.predecessors).toEqual([]);
  });

  it("single operation returns a node with no predecessors", () => {
    const a = run({ command: "a" });
    const tail = pipeline(a);
    expect(asNode(tail).predecessors).toEqual([]);
  });

  it("does not mutate the input operations", () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    pipeline(a, b);
    expect(asNode(a).predecessors).toEqual([]);
    expect(asNode(b).predecessors).toEqual([]);
  });

  it("empty pipeline produces an empty join node", () => {
    const tail = pipeline();
    expect(asNode(tail).kind).toBe("custom");
  });
});
