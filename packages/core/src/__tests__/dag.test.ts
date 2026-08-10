import { describe, it, expect } from "vitest";
import { run } from "../composables/run.js";
import { pipeline } from "../composables/pipeline.js";
import { matrix } from "../composables/matrix.js";
import { workflow } from "../composables/workflow.js";
import { CompositionError } from "../errors.js";
import { makePlanRuntime } from "./helpers/runtime.js";

describe("DAG validation", () => {
  it("rejects a cycle with node ids in context", async () => {
    // User-provided dependsOn string ids forming a cycle: x→y→x.
    // (Predecessor-ref cycles are structurally impossible with immutable
    // after(); cycles arise from explicit dependsOn ids.)
    const x = run({ id: "x", command: "x", dependsOn: ["y"] });
    const y = run({ id: "y", command: "y", dependsOn: ["x"] });
    const wf = workflow("cyclic", x, y);
    const promise = wf.plan(makePlanRuntime());
    await expect(promise).rejects.toThrow(CompositionError);
    try {
      await promise;
    } catch (err) {
      const ce = err as CompositionError;
      expect(ce.context).toBeDefined();
      expect(ce.context?.["cycle"]).toBeDefined();
    }
  });

  it("rejects duplicate user-provided ids", async () => {
    const a = run({ id: "dup", command: "a" });
    const b = run({ id: "dup", command: "b" });
    const wf = workflow("dup-ids", a, b);
    const promise = wf.plan(makePlanRuntime());
    await expect(promise).rejects.toThrow(CompositionError);
    try {
      await promise;
    } catch (err) {
      const ce = err as CompositionError;
      expect(ce.context?.["id"]).toBe("dup");
    }
  });

  it("topo sort respects dependsOn edges (predecessor before successor)", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const wf = workflow("linear", pipeline(a, b, c));
    const result = await wf.plan(makePlanRuntime());
    const ids = result.operations.map((o) => o.id);
    const aIdx = ids.indexOf("run:a");
    const bIdx = ids.indexOf("run:b");
    const cIdx = ids.indexOf("run:c");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
    // b depends on a, c depends on b
    const bSpec = result.operations.find((o) => o.id === "run:b")!;
    const cSpec = result.operations.find((o) => o.id === "run:c")!;
    expect(bSpec.dependsOn).toEqual(["run:a"]);
    expect(cSpec.dependsOn).toEqual(["run:b"]);
  });

  it("parallel siblings have no inter-sibling dependsOn", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const wf = workflow("parallel", a, b);
    const result = await wf.plan(makePlanRuntime());
    const aSpec = result.operations.find((o) => o.id === "run:a")!;
    const bSpec = result.operations.find((o) => o.id === "run:b")!;
    expect(aSpec.dependsOn ?? []).toEqual([]);
    expect(bSpec.dependsOn ?? []).toEqual([]);
  });
});

describe("matrix validation (deferred to planning)", () => {
  it("matrix() does NOT throw at call time (lazy)", () => {
    expect(() => matrix({ node: [] }, run({ command: "test" }))).not.toThrow();
    // non-array value — also deferred
    expect(() =>
      matrix({ node: "not-array" as unknown as readonly unknown[] }, run({ command: "test" })),
    ).not.toThrow();
  });

  it("empty dimension array raises CompositionError at plan time", async () => {
    const op = matrix({ node: [] }, run({ command: "test" }));
    const wf = workflow("empty-matrix", op);
    await expect(wf.plan(makePlanRuntime())).rejects.toThrow(CompositionError);
  });

  it("non-array dimension value raises CompositionError at plan time", async () => {
    const op = matrix(
      { node: "not-array" as unknown as readonly unknown[] },
      run({ command: "test" }),
    );
    const wf = workflow("bad-matrix", op);
    await expect(wf.plan(makePlanRuntime())).rejects.toThrow(CompositionError);
  });
});
