import { describe, it, expect } from "vitest";
import { mergeSpecs, concatDedupe } from "../internal/merge.js";
import { createNode } from "../internal/node.js";
import type { OperationNode } from "../internal/node.js";

describe("concatDedupe", () => {
  it("deduplicates preserving order", () => {
    expect(concatDedupe(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns empty for empty input", () => {
    expect(concatDedupe([])).toEqual([]);
  });
});

describe("mergeSpecs", () => {
  it("scalar fields: b wins when defined", () => {
    const merged = mergeSpecs(
      { command: "a", image: "node:20" },
      { command: "b" },
    );
    expect(merged.command).toBe("b");
    expect(merged.image).toBe("node:20");
  });

  it("undefined values in b do not overwrite a", () => {
    // With exactOptionalPropertyTypes, omit the key rather than passing undefined.
    const merged = mergeSpecs({ command: "a" }, { image: "node:24" });
    expect(merged.command).toBe("a");
    expect(merged.image).toBe("node:24");
  });

  it("dependsOn is concatenated and deduplicated", () => {
    const merged = mergeSpecs(
      { dependsOn: ["a", "b"] },
      { dependsOn: ["b", "c"] },
    );
    expect(merged.dependsOn).toEqual(["a", "b", "c"]);
  });

  it("tags are concatenated and deduplicated", () => {
    const merged = mergeSpecs({ tags: ["x"] }, { tags: ["y", "x"] });
    expect(merged.tags).toEqual(["x", "y"]);
  });

  it("nested objects (cache) are replaced, not deep-merged", () => {
    const merged = mergeSpecs(
      { cache: { inputs: ["a"] } },
      { cache: { inputs: ["b"], key: "k" } },
    );
    expect(merged.cache).toEqual({ inputs: ["b"], key: "k" });
  });

  it("args are replaced (not concatenated)", () => {
    const merged = mergeSpecs({ args: ["a"] }, { args: ["b"] });
    expect(merged.args).toEqual(["b"]);
  });

  it("env is replaced (not merged)", () => {
    const merged = mergeSpecs({ env: { A: "1" } }, { env: { B: "2" } });
    expect(merged.env).toEqual({ B: "2" });
  });
});

describe("createNode", () => {
  it("carries empty predecessors and siblings", () => {
    const n = createNode("run", { command: "echo" }) as OperationNode;
    expect(n.predecessors).toEqual([]);
    expect(n.siblings).toEqual([]);
    expect(n.kind).toBe("run");
    expect(n.spec.command).toBe("echo");
  });
});

describe("Operation methods (immutability)", () => {
  it("after() returns a new node with predecessors appended", () => {
    const a = createNode("run", { command: "a" });
    const b = createNode("run", { command: "b" });
    const bAfterA = b.after(a) as OperationNode;
    expect(bAfterA.predecessors).toHaveLength(1);
    expect((bAfterA.predecessors[0] as OperationNode).spec.command).toBe("a");
    // original unchanged
    expect((b as OperationNode).predecessors).toEqual([]);
  });

  it("after() accepts multiple predecessors", () => {
    const a = createNode("run", { command: "a" });
    const b = createNode("run", { command: "b" });
    const c = createNode("run", { command: "c" });
    const cAfter = c.after(a, b) as OperationNode;
    expect(cAfter.predecessors).toHaveLength(2);
  });

  it("with() returns a new node with siblings appended", () => {
    const a = createNode("run", { command: "a" });
    const b = createNode("run", { command: "b" });
    const aWith = a.with(b) as OperationNode;
    expect(aWith.siblings).toHaveLength(1);
    expect((a as OperationNode).siblings).toEqual([]);
  });

  it("named() sets spec.name and returns a new node", () => {
    const a = createNode("run", { command: "a" });
    const named = a.named("lint");
    expect(named.spec.name).toBe("lint");
    expect(a.spec.name).toBeUndefined();
  });

  it("tagged() concatenates tags and returns a new node", () => {
    const a = createNode("run", { command: "a", tags: ["t1"] });
    const tagged = a.tagged("t2", "t1");
    expect(tagged.spec.tags).toEqual(["t1", "t2"]);
  });

  it("methods do not mutate the receiver", () => {
    const a = createNode("run", { command: "a" });
    const b = createNode("run", { command: "b" });
    a.after(b);
    a.named("x");
    a.tagged("y");
    a.with(b);
    expect((a as OperationNode).predecessors).toEqual([]);
    expect((a as OperationNode).siblings).toEqual([]);
    expect(a.spec.name).toBeUndefined();
    expect(a.spec.tags).toBeUndefined();
  });
});
