import { describe, it, expect } from "vitest";
import { layoutDag } from "../src/dag-layout.js";
import type { DefinitionGraph } from "@sverka/workflow";

function makeGraph(
  steps: { id: string; deps?: { kind: "control" | "value" | "artifact"; producer: string }[] }[],
): DefinitionGraph {
  return {
    project: {
      id: "proj",
      pipelines: [
        {
          id: "ci",
          inputs: {},
          entries: [],
          outputs: [],
          steps: steps.map((s) => ({
            id: s.id,
            runtime: { kind: "host" },
            operations: [{ kind: "shell", command: "echo" }],
            inputs: [],
            outputs: [],
            dependencies: (s.deps ?? []).map((d) => ({
              kind: d.kind,
              producer: d.producer,
              ...(d.kind !== "control" ? { output: "out" } : {}),
            })),
          })),
        },
      ],
    },
  };
}

describe("DagLayout", () => {
  it("1. empty graph returns empty nodes and edges", () => {
    const result = layoutDag(makeGraph([]));
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("2. single step at layer 0, position (0, 0), no edges", () => {
    const result = layoutDag(makeGraph([{ id: "ci/build" }]));
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: "ci/build",
      label: "ci/build",
      x: 0,
      y: 0,
      layer: 0,
    });
    expect(result.edges).toEqual([]);
  });

  it("3. linear chain A→B→C produces layers 0,1,2 and 2 edges", () => {
    const result = layoutDag(
      makeGraph([
        { id: "A" },
        { id: "B", deps: [{ kind: "control", producer: "A" }] },
        { id: "C", deps: [{ kind: "control", producer: "B" }] },
      ]),
    );
    const layers = new Map(result.nodes.map((n) => [n.id, n.layer]));
    expect(layers.get("A")).toBe(0);
    expect(layers.get("B")).toBe(1);
    expect(layers.get("C")).toBe(2);
    expect(result.edges).toHaveLength(2);
    expect(result.edges).toContainEqual({ source: "A", target: "B", label: "control" });
    expect(result.edges).toContainEqual({ source: "B", target: "C", label: "control" });
  });

  it("4. diamond A→B, A→C, B→D, C→D puts D at layer 2", () => {
    const result = layoutDag(
      makeGraph([
        { id: "A" },
        { id: "B", deps: [{ kind: "control", producer: "A" }] },
        { id: "C", deps: [{ kind: "control", producer: "A" }] },
        { id: "D", deps: [{ kind: "control", producer: "B" }, { kind: "control", producer: "C" }] },
      ]),
    );
    const layers = new Map(result.nodes.map((n) => [n.id, n.layer]));
    expect(layers.get("A")).toBe(0);
    expect(layers.get("B")).toBe(1);
    expect(layers.get("C")).toBe(1);
    expect(layers.get("D")).toBe(2);
    expect(result.edges).toHaveLength(4);
  });

  it("5. edge labels carry dependency kind", () => {
    const result = layoutDag(
      makeGraph([
        { id: "A" },
        {
          id: "B",
          deps: [
            { kind: "control", producer: "A" },
            { kind: "artifact", producer: "A" },
          ],
        },
      ]),
    );
    const labels = result.edges.map((e) => e.label);
    expect(labels).toContain("control");
    expect(labels).toContain("artifact");
  });

  it("6. determinism — same graph produces same positions", () => {
    const graph = makeGraph([
      { id: "A" },
      { id: "B", deps: [{ kind: "control", producer: "A" }] },
      { id: "C", deps: [{ kind: "control", producer: "A" }] },
    ]);
    const r1 = layoutDag(graph);
    const r2 = layoutDag(graph);
    expect(r1).toEqual(r2);
  });

  it("7. isolated node placed at layer 0", () => {
    const result = layoutDag(
      makeGraph([
        { id: "A" },
        { id: "B", deps: [{ kind: "control", producer: "A" }] },
        { id: "Z" },
      ]),
    );
    const zNode = result.nodes.find((n) => n.id === "Z");
    expect(zNode?.layer).toBe(0);
    expect(zNode?.x).toBe(0);
  });

  it("8. custom spacing affects positions", () => {
    const graph = makeGraph([
      { id: "A" },
      { id: "B", deps: [{ kind: "control", producer: "A" }] },
    ]);
    const defaultResult = layoutDag(graph);
    const customResult = layoutDag(graph, { nodeSpacingX: 300, nodeSpacingY: 100 });
    const bDefault = defaultResult.nodes.find((n) => n.id === "B")!;
    const bCustom = customResult.nodes.find((n) => n.id === "B")!;
    expect(bCustom.x).toBe(bDefault.x === 200 ? 300 : 300);
    expect(bCustom.x).toBeGreaterThan(bDefault.x);
  });
});
