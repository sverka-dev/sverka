import { describe, it, expect } from "vitest";
import { detectCapabilities } from "../capabilities.js";
import type { DefinitionGraph } from "@sverka/core";

function makeGraph(steps: Array<{ matrix?: unknown; dependencies?: unknown[] }>): DefinitionGraph {
  const graph = {
    project: {
      id: "test",
      pipelines: [
        {
          id: "ci",
          inputs: {},
          entries: [{ id: "push", trigger: { kind: "push" }, roots: ["test"] }],
          steps: steps.map((s, i) => ({
            id: `step${i}`,
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "echo" }],
            outputs: [],
            dependencies: s.dependencies ?? [],
            ...(s.matrix ? { matrix: s.matrix } : {}),
          })),
          outputs: [],
        },
      ],
    },
  } as unknown as DefinitionGraph;
  return graph;
}

describe("Matrix capability detection", () => {
  it("detects graph.matrix when step has matrix", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18, 20] } } }]),
    );
    expect(caps.has("graph.matrix")).toBe(true);
  });

  it("detects matrix.include when include is present", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] }, include: [{ node: 22 }] } }]),
    );
    expect(caps.has("matrix.include")).toBe(true);
  });

  it("detects matrix.exclude when exclude is present", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] }, exclude: [{ node: 18 }] } }]),
    );
    expect(caps.has("matrix.exclude")).toBe(true);
  });

  it("does not detect matrix capabilities when no matrix", () => {
    const caps = detectCapabilities(makeGraph([{}]));
    expect(caps.has("graph.matrix")).toBe(false);
    expect(caps.has("matrix.include")).toBe(false);
    expect(caps.has("matrix.exclude")).toBe(false);
  });

  it("does not detect include/exclude when arrays are empty", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] }, include: [], exclude: [] } }]),
    );
    expect(caps.has("graph.matrix")).toBe(true);
    expect(caps.has("matrix.include")).toBe(false);
    expect(caps.has("matrix.exclude")).toBe(false);
  });

  it("detects matrix.failFast when failFast is set", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] }, failFast: false } }]),
    );
    expect(caps.has("matrix.failFast")).toBe(true);
  });

  it("detects matrix.maxParallel when maxParallel is set", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] }, maxParallel: 4 } }]),
    );
    expect(caps.has("matrix.maxParallel")).toBe(true);
  });

  it("does not detect failFast/maxParallel when not set", () => {
    const caps = detectCapabilities(
      makeGraph([{ matrix: { dimensions: { node: [18] } } }]),
    );
    expect(caps.has("matrix.failFast")).toBe(false);
    expect(caps.has("matrix.maxParallel")).toBe(false);
  });
});
