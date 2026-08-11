import { describe, it, expect } from "vitest";
import { workflow } from "../../composables/workflow.js";
import { run } from "../../composables/run.js";
import { parallel } from "../../composables/parallel.js";
import { pipeline } from "../../composables/pipeline.js";
import { makePlanRuntime } from "../helpers/runtime.js";

describe("workflow()", () => {
  it("returns a frozen workflow with name and roots", () => {
    const a = run({ command: "a" });
    const wf = workflow("ci", a);
    expect(wf.name).toBe("ci");
    expect(wf.roots).toHaveLength(1);
    expect(Object.isFrozen(wf)).toBe(true);
    expect(Object.isFrozen(wf.roots)).toBe(true);
  });

  it("plan() returns a RuntimeResult with all operations", async () => {
    const build = run({ command: "build" });
    const test = run({ command: "test" });
    const lint = run({ command: "lint" });
    const wf = workflow("ci", parallel(build, lint), pipeline(test));
    const result = await wf.plan(makePlanRuntime());
    expect(result.mode).toBe("plan");
    const commands = result.operations.map((o) => o.command).sort();
    expect(commands).toEqual(["build", "lint", "test"]);
  });

  it("plan() with mixed parallel + pipeline roots", async () => {
    const a = run({ command: "a" });
    const b = run({ command: "b" });
    const c = run({ command: "c" });
    const d = run({ command: "d" });
    const wf = workflow("mixed", parallel(a, b), pipeline(c, d));
    const result = await wf.plan(makePlanRuntime());
    const byCmd = new Map(result.operations.map((o) => [o.command, o]));
    const aSpec = byCmd.get("a")!;
    const bSpec = byCmd.get("b")!;
    const cSpec = byCmd.get("c")!;
    const dSpec = byCmd.get("d")!;
    for (const s of [aSpec, bSpec, cSpec, dSpec]) {
      expect(s.id).toMatch(/^op-[0-9a-f]{64}$/);
    }
    // d depends on c
    expect(dSpec.dependsOn).toEqual([cSpec.id]);
  });

  it("empty workflow plans to zero operations", async () => {
    const wf = workflow("empty");
    const result = await wf.plan(makePlanRuntime());
    expect(result.operations).toEqual([]);
  });
});
