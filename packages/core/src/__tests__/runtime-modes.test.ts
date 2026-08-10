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
    expect([...evaluated].sort()).toEqual(["run:a", "run:b"]);
  });

  it("Compile mode produces a string artifact", async () => {
    const a = run({ command: "a" });
    const wf = workflow("compile", a);
    const result = await wf.plan(makeCompileRuntime());
    expect(result.mode).toBe("compile");
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts![0]!.content).toBe("run:a");
  });

  it("skipped condition: evaluate is NOT called, status is 'skipped'", async () => {
    const evaluated: string[] = [];
    const nightly = when(
      "schedule == 'nightly'",
      run({ command: "full-scan" }),
    );
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
    const nightly = when(
      "schedule == 'nightly'",
      run({ command: "full-scan" }),
    );
    const wf = workflow("cond-in", nightly);
    await wf.plan(
      makeExecuteRuntime({ schedule: "nightly" }, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual(["run:full-scan"]);
  });

  it("no context: all conditions included by default", async () => {
    const evaluated: string[] = [];
    const guarded = when("schedule == 'nightly'", run({ command: "scan" }));
    const wf = workflow("no-ctx", guarded);
    await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        evaluated.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(evaluated).toEqual(["run:scan"]);
  });

  it("pipeline ordering preserved through execute", async () => {
    const order: string[] = [];
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const wf = workflow("ordered", pipeline(a, b, c));
    await wf.plan(
      makeExecuteRuntime(undefined, (spec) => {
        order.push(spec.id);
        return { operationId: spec.id, status: "success", durationMs: 0 };
      }),
    );
    expect(order).toEqual(["run:a", "run:b", "run:c"]);
  });
});
