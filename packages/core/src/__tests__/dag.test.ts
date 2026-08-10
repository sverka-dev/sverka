import { describe, it, expect } from "vitest";
import { run } from "../composables/run.js";
import { pipeline } from "../composables/pipeline.js";
import { matrix } from "../composables/matrix.js";
import { workflow } from "../composables/workflow.js";
import { CompositionError } from "../errors.js";
import { makePlanRuntime } from "./helpers/runtime.js";

const OP_ID_RE = /^op-[0-9a-f]{64}$/;

describe("DAG validation", () => {
  it("rejects a cycle with node ids in context", async () => {
    // User-provided spec.id aliases referenced in dependsOn form a cycle: x→y→x.
    const x = run({ id: "x", command: "x", dependsOn: ["y"] });
    const y = run({ id: "y", command: "y", dependsOn: ["x"] });
    const wf = workflow("cyclic", x, y);
    const promise = wf.plan(makePlanRuntime());
    await expect(promise).rejects.toThrow(CompositionError);
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionError);
      if (!(err instanceof CompositionError)) return;
      expect(err.context).toBeDefined();
      expect(err.context?.["cycle"]).toBeDefined();
    }
  });

  it("rejects duplicate user-provided spec.id aliases", async () => {
    const a = run({ id: "dup", command: "a" });
    const b = run({ id: "dup", command: "b" });
    const wf = workflow("dup-ids", a, b);
    const promise = wf.plan(makePlanRuntime());
    await expect(promise).rejects.toThrow(CompositionError);
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionError);
      if (!(err instanceof CompositionError)) return;
      expect(err.context?.["id"]).toBe("dup");
    }
  });

  it("rejects true duplicate operations (identical kind/name/context)", async () => {
    const a = run({ command: "echo" });
    const b = run({ command: "echo" });
    const wf = workflow("true-dups", a, b);
    const promise = wf.plan(makePlanRuntime());
    await expect(promise).rejects.toThrow(CompositionError);
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(CompositionError);
      if (!(err instanceof CompositionError)) return;
      expect(err.context?.["id"]).toMatch(OP_ID_RE);
    }
  });

  it("topo sort respects dependsOn edges (predecessor before successor)", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const wf = workflow("linear", pipeline(a, b, c));
    const result = await wf.plan(makePlanRuntime());
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    const aSpec = byCmd.get("a")!;
    const bSpec = byCmd.get("b")!;
    const cSpec = byCmd.get("c")!;
    const ids = result.operations.map((o) => o.id);
    expect(ids.indexOf(aSpec.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(bSpec.id)).toBeGreaterThan(ids.indexOf(aSpec.id));
    expect(ids.indexOf(cSpec.id)).toBeGreaterThan(ids.indexOf(bSpec.id));
    expect(bSpec.dependsOn).toEqual([aSpec.id]);
    expect(cSpec.dependsOn).toEqual([bSpec.id]);
  });

  it("parallel siblings have no inter-sibling dependsOn", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const wf = workflow("parallel", a, b);
    const result = await wf.plan(makePlanRuntime());
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    const aSpec = byCmd.get("a")!;
    const bSpec = byCmd.get("b")!;
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
