import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API surface", () => {
  it("exports every spec-listed symbol", () => {
    // Types are erased at runtime, but the value exports must be present.
    expect(typeof api.run).toBe("function");
    expect(typeof api.pipeline).toBe("function");
    expect(typeof api.parallel).toBe("function");
    expect(typeof api.when).toBe("function");
    expect(typeof api.matrix).toBe("function");
    expect(typeof api.workflow).toBe("function");
    expect(typeof api.CoreError).toBe("function");
    expect(typeof api.PlanningError).toBe("function");
    expect(typeof api.CompositionError).toBe("function");
  });

  it("CoreError is a constructor extending Error", () => {
    const err = new api.CoreError("m", "CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CODE");
  });

  it("run() returns an Operation with the expected shape", () => {
    const op = api.run({ command: "echo" });
    expect(op.kind).toBe("run");
    expect(typeof op.after).toBe("function");
    expect(typeof op.with).toBe("function");
    expect(typeof op.named).toBe("function");
    expect(typeof op.tagged).toBe("function");
  });

  it("workflow() returns a Workflow with a plan function", () => {
    const wf = api.workflow("ci", api.run({ command: "a" }));
    expect(wf.name).toBe("ci");
    expect(typeof wf.plan).toBe("function");
    expect(Array.isArray(wf.roots)).toBe(true);
  });

  it("internal modules are not re-exported from the public entry", async () => {
    // The public index must not export internal helpers. We verify by
    // checking that the known internal module paths are not present as
    // named exports of the public barrel.
    const publicNames = Object.keys(api);
    const internalLeaked = publicNames.filter((n) =>
      [
        "createNode",
        "asNode",
        "withSpec",
        "mergeSpecs",
        "concatDedupe",
        "planWorkflow",
        "evaluateCondition",
      ].includes(n),
    );
    expect(internalLeaked).toEqual([]);
  });

  it("exports computeOperationId (content-addressed id primitive, ADR-006)", () => {
    // computeOperationId is a pure, dependency-free primitive that any
    // consumer (planner, compiler, ir) can use to recompute an operation id
    // from its content. It is part of the stable public contract.
    expect(typeof api.computeOperationId).toBe("function");
    expect(api.computeOperationId("run", "build", {})).toMatch(/^op-[0-9a-f]{64}$/);
  });

  it("exports canonicalStringify (canonical JSON primitive, ADR-006)", () => {
    // canonicalStringify is the stable serialization primitive shared by
    // computeOperationId and the ir package's serializePlan/computePlanId.
    expect(typeof api.canonicalStringify).toBe("function");
    expect(api.canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
