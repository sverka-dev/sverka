import { describe, it, expect } from "vitest";
import { run } from "../composables/run.js";
import { matrix } from "../composables/matrix.js";
import { workflow } from "../composables/workflow.js";
import { CompositionError } from "../errors.js";
import { makePlanRuntime } from "./helpers/runtime.js";

describe("matrix expansion", () => {
  it("produces one node per value with distinct ids and MATRIX_<DIM> env", async () => {
    const op = matrix({ node: ["20", "24"] }, run({ command: "test" }));
    const wf = workflow("matrix-1d", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(2);
    const ids = result.operations.map((o) => o.id).sort();
    expect(ids).toEqual(["run:test[node=s:20]", "run:test[node=s:24]"]);
    const envs = result.operations.map((o) => o.env?.MATRIX_NODE).sort();
    expect(envs).toEqual(["20", "24"]);
  });

  it("multi-dimension cartesian product with joined id suffix", async () => {
    const op = matrix({ node: ["20", "24"], os: ["linux", "macos"] }, run({ command: "test" }));
    const wf = workflow("matrix-2d", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(4);
    const ids = result.operations.map((o) => o.id).sort();
    expect(ids).toEqual([
      "run:test[node=s:20,os=s:linux]",
      "run:test[node=s:20,os=s:macos]",
      "run:test[node=s:24,os=s:linux]",
      "run:test[node=s:24,os=s:macos]",
    ]);
    const envs = result.operations
      .map((spec) => `${spec.env?.MATRIX_NODE}/${spec.env?.MATRIX_OS}`)
      .sort();
    expect(envs).toEqual(["20/linux", "20/macos", "24/linux", "24/macos"]);
  });

  it("children inherit predecessors from the template", async () => {
    const build = run({ command: "build" });
    const test = run({ command: "test" });
    const matrixed = matrix({ node: ["20", "24"] }, test).after(build);
    const wf = workflow("matrix-deps", matrixed);
    const result = await wf.plan(makePlanRuntime());
    const children = result.operations.filter((spec) => spec.id.startsWith("run:test["));
    expect(children).toHaveLength(2);
    for (const spec of children) {
      expect(spec.dependsOn).toEqual(["run:build"]);
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

  it("duplicate matrix values raise CompositionError", async () => {
    const op = matrix({ node: ["20", "20"] }, run({ command: "test" }));
    const wf = workflow("matrix-dup", op);
    await expect(wf.plan(makePlanRuntime())).rejects.toThrow(CompositionError);
  });

  it("delimiter characters in values are escaped in ids", async () => {
    const op = matrix({ key: ["a,b=c"] }, run({ command: "test" }));
    const wf = workflow("matrix-escape", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(1);
    // The comma and equals in the value should be escaped, not treated as
    // dimension boundaries.
    const id = result.operations[0]!.id;
    expect(id).toContain("a\\,b\\=c");
  });

  it("number and string values with the same text produce distinct ids", async () => {
    const op = matrix({ v: [1, "1", true] }, run({ command: "test" }));
    const wf = workflow("matrix-types", op);
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toHaveLength(3);
    expect(result.operations.map((o) => o.id).sort()).toEqual([
      "run:test[v=b:true]",
      "run:test[v=n:1]",
      "run:test[v=s:1]",
    ]);
  });
});
