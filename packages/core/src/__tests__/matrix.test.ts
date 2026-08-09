import { describe, it, expect } from "vitest";
import { run } from "../composables/run.js";
import { matrix } from "../composables/matrix.js";
import { workflow } from "../composables/workflow.js";
import { makePlanRuntime } from "./helpers/runtime.js";
import { computeOperationId } from "../internal/ids.js";

const OP_ID_RE = /^op-[0-9a-f]{64}$/;

describe("matrix expansion", () => {
  it("produces one node per value with distinct op- ids and MATRIX_<DIM> env", async () => {
    const op = matrix({ node: ["20", "24"] }, run({ command: "test" }));
    const wf = workflow("matrix-1d", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(2);
    const ids = result.operations.map((o) => o.id);
    for (const id of ids) expect(id).toMatch(OP_ID_RE);
    expect(new Set(ids).size).toBe(ids.length); // distinct
    // ids are content-addressed over {kind, name, context:{node, command}}
    const expected = ["20", "24"].map((v) =>
      computeOperationId("run", "test", { node: v, command: "test" }),
    );
    expect(ids.sort()).toEqual([...expected].sort());
    const envs = result.operations.map((o) => o.env?.MATRIX_NODE).sort();
    expect(envs).toEqual(["20", "24"]);
  });

  it("multi-dimension cartesian product with distinct op- ids", async () => {
    const op = matrix({ node: ["20", "24"], os: ["linux"] }, run({ command: "test" }));
    const wf = workflow("matrix-2d", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(2);
    const ids = result.operations.map((o) => o.id);
    for (const id of ids) expect(id).toMatch(OP_ID_RE);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of result.operations) {
      expect(spec.env?.MATRIX_NODE).toBeDefined();
      expect(spec.env?.MATRIX_OS).toBe("linux");
    }
  });

  it("children inherit predecessors from the template", async () => {
    const build = run({ command: "build" });
    const test = run({ command: "test" });
    const matrixed = matrix({ node: ["20", "24"] }, test).after(build);
    const wf = workflow("matrix-deps", matrixed);
    const result = await wf.plan(makePlanRuntime());
    const buildSpec = result.operations.find((o) => o.command === "build")!;
    const testSpecs = result.operations.filter((o) => o.command === "test");
    expect(testSpecs.length).toBe(2);
    for (const spec of testSpecs) {
      expect(spec.dependsOn).toEqual([buildSpec.id]);
    }
  });

  it("matrix marker is stripped from emitted specs", async () => {
    const op = matrix({ node: ["20"] }, run({ command: "test" }));
    const wf = workflow("matrix-marker", op);
    const result = await wf.plan(makePlanRuntime());
    for (const spec of result.operations) {
      expect((spec as unknown as Record<string, unknown>).__matrixTemplate).toBeUndefined();
    }
  });

  it("three values produce three nodes", async () => {
    const op = matrix({ node: ["20", "22", "24"] }, run({ command: "test" }));
    const wf = workflow("matrix-3", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(3);
  });
});
