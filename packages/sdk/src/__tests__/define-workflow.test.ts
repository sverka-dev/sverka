import { describe, it, expect } from "vitest";
import {
  defineWorkflow,
  pipeline,
  task,
  run,
  workflow,
  type WorkflowDefinition,
} from "../index.js";

describe("defineWorkflow", () => {
  it("returns the same object passed in (identity)", () => {
    const def: WorkflowDefinition = {
      name: "ci",
      workflow: workflow(
        "ci",
        pipeline(task("lint", run({ command: "true" }))),
      ),
    };
    const result = defineWorkflow(def);
    expect(result).toBe(def);
  });

  it("preserves the name and workflow", () => {
    const wf = workflow("ci", pipeline(task("lint", run({ command: "true" }))));
    const result = defineWorkflow({ name: "ci", workflow: wf });
    expect(result.name).toBe("ci");
    expect(result.workflow).toBe(wf);
  });

  it("preserves optional policy config", () => {
    const result = defineWorkflow({
      name: "ci",
      workflow: workflow(
        "ci",
        pipeline(task("lint", run({ command: "true" }))),
      ),
      policy: {
        failOn: [{ severity: "high", onlyNew: false }],
      },
    });
    expect(result.policy).toBeDefined();
    expect(result.policy?.failOn).toHaveLength(1);
  });
});
