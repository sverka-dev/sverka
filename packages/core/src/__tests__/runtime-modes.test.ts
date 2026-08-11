import { describe, it, expect } from "vitest";
import { workflow } from "../composables/workflow.js";
import { run } from "../composables/run.js";
import { parallel } from "../composables/parallel.js";
import { pipeline } from "../composables/pipeline.js";
import { when } from "../composables/when.js";
import {
  makePlanRuntime,
  makeExecuteRuntime,
  makeCompileRuntime,
} from "./helpers/runtime.js";

describe("Runtime modes", () => {
  it("Plan mode records all operations without executing", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const wf = workflow("plan", parallel(a, b));
    const result = await wf.plan(makePlanRuntime());
    expect(result.mode).toBe("plan");
    expect(result.operations).toHaveLength(2);
    // No artifacts in plan mode
    expect(result.artifacts).toBeUndefined();
  });

  it("Plan mode preserves false-conditioned operations without evaluating", async () => {
    const evaluated: string[] = [];
    const nightly = when("schedule == 'nightly'", run({ command: "full-scan" }));
    const always = run({ command: "always" });
    const wf = workflow("plan-cond", pipeline(nightly, always));
    const result = await wf.plan(
      makePlanRuntime({ schedule: "ci" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "planned", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual([result.operations[1]!.id]);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]!.condition).toBe("schedule == 'nightly'");
  });

  it("Execution mode calls evaluate for each non-skipped op", async () => {
    const evaluated: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const wf = workflow("exec", parallel(a, b));
    const result = await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 1 };
      }),
    );
    expect(result.mode).toBe("execute");
    expect(evaluated).toHaveLength(2);
    // ids are content-addressed op-<64hex>; both evaluated ids match the plan ids
    const planIds = result.operations.map((o) => o.id);
    expect([...evaluated].sort()).toEqual([...planIds].sort());
    for (const id of evaluated) expect(id).toMatch(/^op-[0-9a-f]{64}$/);
  });

  it("Compile mode produces a string artifact", async () => {
    const a = run({ command: "a" });
    const wf = workflow("compile", a);
    const result = await wf.plan(makeCompileRuntime());
    expect(result.mode).toBe("compile");
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts).toHaveLength(1);
    // artifact content is the joined op- ids of evaluated operations
    expect(result.artifacts![0]!.content).toMatch(/^op-[0-9a-f]{64}$/);
  });

  it("skipped condition: evaluate is NOT called, status is 'skipped'", async () => {
    const evaluated: string[] = [];
    const nightly = when("schedule == 'nightly'", run({ command: "full-scan" }));
    const wf = workflow("cond", nightly);
    const result = await wf.plan(
      makeExecuteRuntime({ schedule: "ci" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual([]);
    // operation still recorded in the graph with its condition
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.condition).toBe("schedule == 'nightly'");
  });

  it("included condition: evaluate IS called", async () => {
    const evaluated: string[] = [];
    const nightly = when("schedule == 'nightly'", run({ command: "full-scan" }));
    const wf = workflow("cond-in", nightly);
    const result = await wf.plan(
      makeExecuteRuntime({ schedule: "nightly" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual([result.operations[0]!.id]);
    expect(evaluated[0]).toMatch(/^op-[0-9a-f]{64}$/);
  });

  it("no context: all conditions included by default", async () => {
    const evaluated: string[] = [];
    const guarded = when("schedule == 'nightly'", run({ command: "scan" }));
    const wf = workflow("no-ctx", guarded);
    const result = await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual([result.operations[0]!.id]);
  });

  it("pipeline ordering preserved through execute", async () => {
    const order: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const wf = workflow("ordered", pipeline(a, b, c));
    const result = await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        order.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    // ordering follows the topo-sorted plan ids: a, b, c by command
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    expect(order).toEqual([byCmd.get("a")!.id, byCmd.get("b")!.id, byCmd.get("c")!.id]);
  });

  it("compile mode receives all operations including false-condition ones", async () => {
    const evaluated: string[] = [];
    const nightly = when("schedule == 'nightly'", run({ command: "full-scan" }));
    const always = run({ command: "always" });
    const wf = workflow("compile-cond", pipeline(nightly, always));
    const result = await wf.plan(
      makeCompileRuntime({ schedule: "ci" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "planned", durationMs: 0 };
      }),
    );
    // In compile mode, false-condition operations are still passed to the
    // compiler so it can emit them with their condition field.
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    expect(evaluated).toContain(byCmd.get("full-scan")!.id);
    expect(evaluated).toContain(byCmd.get("always")!.id);
    expect(result.operations).toHaveLength(2);
  });

  it("execute mode stops after failure unless continueOnError", async () => {
    const evaluated: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const wf = workflow("fail-stop", pipeline(a, b, c));
    const result = await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        evaluated.push(spec.id);
        if (spec.command === "b") {
          return { operationId: spec.id, status: "failure", durationMs: 0 };
        }
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    // b fails, c should be cancelled (not evaluated)
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    expect(evaluated).toEqual([byCmd.get("a")!.id, byCmd.get("b")!.id]);
    const cOutcome = result.outcomes!.find((o) => o.operationId === byCmd.get("c")!.id);
    expect(cOutcome?.status).toBe("cancelled");
  });

  it("execute mode continues after failure when continueOnError is set", async () => {
    const evaluated: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b", continueOnError: true });
    const c = run({ command: "c" });
    const wf = workflow("fail-continue", pipeline(a, b, c));
    const result = await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        evaluated.push(spec.id);
        const status = spec.command === "b" ? "failure" : "success";
        return { operationId: spec.id, status, durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual(result.operations.map((o) => o.id));
    const cOutcome = result.outcomes.find((o) =>
      result.operations.some((op) => op.id === o.operationId && op.command === "c"),
    );
    expect(cOutcome?.status).toBe("success");
  });

  it("when(condition, parallel(...)) propagates condition to siblings", async () => {
    const evaluated: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const guarded = when("schedule == 'nightly'", parallel(a, b));
    const wf = workflow("parallel-cond", guarded);
    const result = await wf.plan(
      makeExecuteRuntime({ schedule: "ci" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    // Both siblings should be skipped because the condition is false
    expect(evaluated).toEqual([]);
    expect(result.operations).toHaveLength(2);
    for (const spec of result.operations) {
      expect(spec.condition).toContain("schedule == 'nightly'");
    }
  });
});
